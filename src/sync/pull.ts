import { type SQL, sql } from 'drizzle-orm';
import { activeMemberOf } from '../access/membership';
import type { Category } from '../actions/categories';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { tables } from '../db/tables';
import type { SplitMethod } from '../money/split';
import {
  type GroupChanges,
  LIMITS,
  type SyncedComment,
  type SyncedExpense,
  type SyncedGroup,
  type SyncedMember,
  type SyncedPayment,
} from './format';

/**
 * **The pull** (DESIGN.md §11.3): for every group the account is an active member of, the rows whose `seq` is past the device's cursor, **paged at
 * `seq` boundaries** so that a page never ends half way through one change, and a budget of rows shared by the request's groups; a group whose cursor
 * is zero gets its snapshot. **The membership is in every statement**: a group the account left is not among them, and the caller names it gone.
 *
 * Every row a change touches is stamped with the group's `seq` of that change (`src/sync/apply.ts`, `src/groups/`), so "past the cursor" is exactly
 * "changed since". An expense comes with its payers and shares.
 */
const num = (value: unknown) => Number(value);
const numOrNull = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);
const bool = (value: unknown) => value === true || Number(value) === 1;

export interface PullResult {
  groups: GroupChanges[];
  /** The ids of the account's groups, to tell which of the device's are gone. */
  ids: Set<string>;
}

export async function pull(
  database: Database,
  accountId: string,
  cursors: Readonly<Record<string, number>>,
  budget: number = LIMITS.rowsPerRequest,
): Promise<PullResult> {
  const t = tables(database);
  const groups = await dbAll<Record<string, unknown>>(
    database,
    sql`SELECT g.id, g.sealed, g.color, g.default_currency AS "defaultCurrency", g.simplify_debts AS "simplifyDebts", g.closed_at AS "closedAt",
               g.key_epoch AS "keyEpoch", g.seq
        FROM ${t.grp} g WHERE ${activeMemberOf(database, sql`g.id`, accountId)} ORDER BY g.id`,
  );
  let left = budget;
  const out: GroupChanges[] = [];
  for (const raw of groups) {
    const group: SyncedGroup = {
      id: String(raw.id),
      sealed: String(raw.sealed),
      color: String(raw.color),
      defaultCurrency: String(raw.defaultCurrency),
      simplifyDebts: bool(raw.simplifyDebts),
      closedAt: numOrNull(raw.closedAt),
      keyEpoch: num(raw.keyEpoch),
      seq: num(raw.seq),
    };
    let cursor = cursors[group.id] ?? 0;
    // A cursor past the group's own counter is not one this group gave: start it again from its snapshot.
    if (cursor > group.seq) cursor = 0;
    const empty = { group, members: [], expenses: [], payments: [], comments: [], tombstones: [] };
    if (cursor === group.seq) {
      out.push({ ...empty, cursor, more: false });
      continue;
    }
    if (left <= 0) {
      out.push({ ...empty, cursor, more: true });
      continue;
    }
    const changes = await groupSince(database, accountId, group, cursor, left);
    left -=
      changes.members.length +
      changes.expenses.length +
      changes.payments.length +
      changes.comments.length;
    out.push(changes);
  }
  return { groups: out, ids: new Set(out.map((g) => g.group.id)) };
}

async function groupSince(
  database: Database,
  accountId: string,
  group: SyncedGroup,
  cursor: number,
  budget: number,
): Promise<GroupChanges> {
  const t = tables(database);
  const allowed = activeMemberOf(database, group.id, accountId);
  const since = (table: unknown, columns: SQL) =>
    dbAll<Record<string, unknown>>(
      database,
      sql`SELECT ${columns} FROM ${table} x WHERE x.group_id = ${group.id} AND x.seq > ${cursor} AND ${allowed}
          ORDER BY x.seq, x.id LIMIT ${budget + 1}`,
    );

  const [members, expenses, payments, comments] = await Promise.all([
    dbAll<Record<string, unknown>>(
      database,
      sql`SELECT x.id, x.person_id AS "personId", p.name, x.role, p.account_id AS "accountId", p.deleted_at AS "deletedAt",
                 x.joined_at AS "joinedAt", x.left_at AS "leftAt", x.seq
          FROM ${t.member} x JOIN ${t.person} p ON p.id = x.person_id
          WHERE x.group_id = ${group.id} AND x.seq > ${cursor} AND ${allowed}
          ORDER BY x.seq, x.id LIMIT ${budget + 1}`,
    ),
    since(
      t.expense,
      sql`x.id, x.sealed, x.amount, x.currency, x.date, x.category, x.method, x.version, x.created_by AS "createdBy", x.updated_by AS "updatedBy",
          x.deleted_at AS "deletedAt", x.created_at AS "createdAt", x.updated_at AS "updatedAt", x.seq`,
    ),
    since(
      t.payment,
      sql`x.id, x.sealed, x.from_member_id AS "fromMemberId", x.to_member_id AS "toMemberId", x.amount, x.currency, x.date, x.version,
          x.created_by AS "createdBy", x.updated_by AS "updatedBy", x.deleted_at AS "deletedAt", x.created_at AS "createdAt",
          x.updated_at AS "updatedAt", x.seq`,
    ),
    since(
      t.comment,
      sql`x.id, x.subject, x.subject_id AS "subjectId", x.author_person_id AS "authorPersonId", x.sealed, x.deleted_at AS "deletedAt",
          x.created_at AS "createdAt", x.seq`,
    ),
  ]);

  // Where this page ends: all of it, or the last `seq` of the first `budget` rows, every row of that `seq` included. Each list was read to `budget + 1`,
  // so every row at or before that `seq` is among them.
  const seqs = [...members, ...expenses, ...payments, ...comments]
    .map((r) => num(r.seq))
    .sort((a, b) => a - b);
  const more = seqs.length > budget;
  const through = more ? (seqs[budget - 1] ?? cursor) : group.seq;
  const within = (rows: Record<string, unknown>[]) => rows.filter((r) => num(r.seq) <= through);

  const pickedExpenses = within(expenses);
  const ids = pickedExpenses.map((e) => String(e.id));
  const [payers, shares] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          dbAll<{ expenseId: string; memberId: string; amount: number }>(
            database,
            sql`SELECT expense_id AS "expenseId", member_id AS "memberId", amount FROM ${t.expensePayer}
                WHERE group_id = ${group.id} AND expense_id IN (${sql.join(
                  ids.map((id) => sql`${id}`),
                  sql`, `,
                )}) ORDER BY member_id`,
          ),
          dbAll<{ expenseId: string; memberId: string; amount: number; units: number | null }>(
            database,
            sql`SELECT expense_id AS "expenseId", member_id AS "memberId", amount, units FROM ${t.expenseShare}
                WHERE group_id = ${group.id} AND expense_id IN (${sql.join(
                  ids.map((id) => sql`${id}`),
                  sql`, `,
                )}) ORDER BY member_id`,
          ),
        ]);

  return {
    group,
    members: within(members).map((r): SyncedMember => ({
      id: String(r.id),
      personId: String(r.personId),
      name: String(r.name),
      role: (r.role ?? null) as SyncedMember['role'],
      placeholder: r.accountId === null && r.deletedAt === null,
      leftTally: r.deletedAt !== null,
      joinedAt: num(r.joinedAt),
      leftAt: numOrNull(r.leftAt),
      seq: num(r.seq),
    })),
    expenses: pickedExpenses.map((r): SyncedExpense => ({
      id: String(r.id),
      sealed: String(r.sealed),
      amount: num(r.amount),
      currency: String(r.currency),
      date: String(r.date),
      category: String(r.category) as Category,
      method: String(r.method) as SplitMethod,
      payers: payers
        .filter((p) => p.expenseId === r.id)
        .map((p) => ({ memberId: p.memberId, amount: num(p.amount) })),
      shares: shares
        .filter((s) => s.expenseId === r.id)
        .map((s) => ({ memberId: s.memberId, amount: num(s.amount), units: numOrNull(s.units) })),
      version: num(r.version),
      createdBy: String(r.createdBy),
      updatedBy: String(r.updatedBy),
      deletedAt: numOrNull(r.deletedAt),
      createdAt: num(r.createdAt),
      updatedAt: num(r.updatedAt),
      seq: num(r.seq),
    })),
    payments: within(payments).map((r): SyncedPayment => ({
      id: String(r.id),
      sealed: r.sealed === null ? null : String(r.sealed),
      fromMemberId: String(r.fromMemberId),
      toMemberId: String(r.toMemberId),
      amount: num(r.amount),
      currency: String(r.currency),
      date: String(r.date),
      version: num(r.version),
      createdBy: String(r.createdBy),
      updatedBy: String(r.updatedBy),
      deletedAt: numOrNull(r.deletedAt),
      createdAt: num(r.createdAt),
      updatedAt: num(r.updatedAt),
      seq: num(r.seq),
    })),
    comments: within(comments).map((r): SyncedComment => ({
      id: String(r.id),
      subject: String(r.subject) as SyncedComment['subject'],
      subjectId: String(r.subjectId),
      authorPersonId: String(r.authorPersonId),
      sealed: String(r.sealed),
      deletedAt: numOrNull(r.deletedAt),
      createdAt: num(r.createdAt),
      seq: num(r.seq),
    })),
    tombstones: [],
    cursor: through,
    more,
  };
}
