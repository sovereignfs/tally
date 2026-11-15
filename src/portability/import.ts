import { sql } from 'drizzle-orm';
import { type GroupContext, checkComment, checkExpense, checkPayment } from '../actions/validate';
import type { ExpenseRow, PaymentRow } from '../actions/types';
import { recordActivity } from '../activity/record';
import { parseSealed } from '../cipher/seal';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import { tables } from '../db/tables';
import { isGroupColor } from '../groups/colors';
import { OpError } from '../groups/errors';
import { MAX_GROUPS, MAX_MEMBERS } from '../groups/ops';
import { checkWrapped } from '../keys/store';
import { toMinor } from '../money/amount';
import { isSupportedCurrencyCode } from '../money/currencies';
import { NAME_MAX, cleanName } from '../people/persons';
import { importGroupRows } from '../sync/apply';
import { RateLimiter, type Rule } from '../limits/rate';
import { MAX_GROUPS_IN_FILE, MAX_ROWS_IN_GROUP } from './validate';

/**
 * **Importing makes new groups** (DESIGN.md §17), on the server, from what the browser checked and sealed (`prepare.ts`): **checked again, whole, before
 * anything is written**, every row as a change is checked (`src/actions/validate.ts`), and **written in one transaction**, or not at all. The importer
 * is each group's owner; every other member becomes a placeholder with their name and no email, so that nobody else is joined to anything without
 * asking. The members keep their order, which a split's leftover follows. Ids are the browser's, new for this import.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_SEALED_NAME = 2_048;
/** Every row of every group of one import together: a file larger than any real history is refused before anything is read further. */
export const MAX_ROWS_IN_IMPORT = 50_000;
/** Imports per account and hour: each writes a great deal in one transaction. */
export const IMPORT_RATE: Rule = { limit: 10, windowMs: 60 * 60 * 1000 };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const invalid = (): never => {
  throw new OpError(
    'invalid',
    'That file could not be imported: it is not as it should be. Nothing was imported.',
  );
};
const uuid = (v: unknown, seen: Set<string>): string => {
  if (typeof v !== 'string' || !UUID.test(v) || seen.has(v)) return invalid();
  seen.add(v);
  return v;
};

interface CheckedGroup {
  groupId: string;
  sealed: string;
  keyWrap: string;
  color: string;
  defaultCurrency: string;
  simplifyDebts: boolean;
  members: { id: string; name: string; you: boolean; left: boolean }[];
  expenses: (ExpenseRow & { id: string })[];
  payments: (PaymentRow & { id: string })[];
  comments: {
    id: string;
    subject: 'expense' | 'payment';
    subjectId: string;
    authorMemberId: string | null;
    sealed: string;
  }[];
}

function checkGroup(g: unknown, seen: Set<string>): CheckedGroup {
  if (!isObject(g)) return invalid();
  const groupId = uuid(g.groupId, seen);
  if (typeof g.sealed !== 'string' || g.sealed.length > MAX_SEALED_NAME) return invalid();
  try {
    if (parseSealed(g.sealed).epoch !== 1) invalid();
  } catch {
    invalid();
  }
  let keyWrap: string;
  try {
    keyWrap = checkWrapped(g.keyWrap);
  } catch {
    return invalid();
  }
  if (
    !isGroupColor(g.color) ||
    typeof g.defaultCurrency !== 'string' ||
    !isSupportedCurrencyCode(g.defaultCurrency)
  )
    return invalid();
  if (typeof g.simplifyDebts !== 'boolean') return invalid();
  if (!Array.isArray(g.members) || g.members.length === 0 || g.members.length > MAX_MEMBERS)
    return invalid();
  const members = (g.members as unknown[]).map((m) => {
    if (
      !isObject(m) ||
      typeof m.name !== 'string' ||
      typeof m.you !== 'boolean' ||
      typeof m.left !== 'boolean'
    )
      return invalid();
    const name = cleanName(m.name);
    if (!name || [...name].length > NAME_MAX) return invalid();
    return { id: uuid(m.id, seen), name, you: m.you, left: m.left && !m.you };
  });
  if (members.filter((m) => m.you).length !== 1) return invalid();
  const context: GroupContext = {
    order: members.map((m) => m.id),
    active: new Set(members.map((m) => m.id)),
    epoch: 1,
  };

  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : invalid());
  const rows = list(g.expenses).length + list(g.payments).length;
  if (rows > MAX_ROWS_IN_GROUP) return invalid();
  const expenses = list(g.expenses).map((e) => {
    if (!isObject(e) || !Array.isArray(e.payers) || !Array.isArray(e.shares)) return invalid();
    const id = uuid(e.id, seen);
    let checked;
    try {
      checked = checkExpense(
        {
          sealed: e.sealed as string,
          amount: toMinor(e.amount),
          currency: e.currency as string,
          date: e.date as string,
          category: e.category as ExpenseRow['category'],
          method: e.method as ExpenseRow['method'],
          payers: (e.payers as Record<string, unknown>[]).map((p) => ({
            memberId: String(p?.memberId),
            amount: toMinor(p?.amount),
          })),
          shares: (e.shares as Record<string, unknown>[]).map((s) => ({
            memberId: String(s?.memberId),
            amount: toMinor(s?.amount),
            units: s?.units === null || s?.units === undefined ? null : Number(s.units),
          })),
        },
        context,
      );
    } catch {
      return invalid();
    }
    if (!checked.ok) return invalid();
    return { ...checked.value, id };
  });
  const payments = list(g.payments).map((p) => {
    if (!isObject(p)) return invalid();
    const id = uuid(p.id, seen);
    let checked;
    try {
      checked = checkPayment(
        {
          sealed: p.sealed === null ? null : (p.sealed as string),
          fromMemberId: String(p.fromMemberId),
          toMemberId: String(p.toMemberId),
          amount: toMinor(p.amount),
          currency: p.currency as string,
          date: p.date as string,
        },
        context,
      );
    } catch {
      return invalid();
    }
    if (!checked.ok) return invalid();
    return { ...checked.value, id };
  });
  const subjects = new Map<string, 'expense' | 'payment'>([
    ...expenses.map((e) => [e.id, 'expense'] as const),
    ...payments.map((p) => [p.id, 'payment'] as const),
  ]);
  const comments = list(g.comments).map((c) => {
    if (!isObject(c)) return invalid();
    const id = uuid(c.id, seen);
    if (
      (c.subject !== 'expense' && c.subject !== 'payment') ||
      subjects.get(String(c.subjectId)) !== c.subject
    )
      return invalid();
    if (c.authorMemberId !== null && !context.active.has(String(c.authorMemberId)))
      return invalid();
    const checked = checkComment(
      { subject: c.subject, subjectId: String(c.subjectId), sealed: c.sealed as string },
      context,
    );
    if (!checked.ok) return invalid();
    return {
      id,
      subject: c.subject as 'expense' | 'payment',
      subjectId: String(c.subjectId),
      authorMemberId: c.authorMemberId === null ? null : String(c.authorMemberId),
      sealed: checked.value.sealed,
    };
  });
  return {
    groupId,
    sealed: g.sealed,
    keyWrap,
    color: g.color,
    defaultCurrency: g.defaultCurrency,
    simplifyDebts: g.simplifyDebts,
    members,
    expenses,
    payments,
    comments,
  };
}

export async function importGroups(
  database: Database,
  who: { accountId: string; personId: string },
  input: unknown,
  now = Date.now(),
): Promise<{ groups: string[] }> {
  if (
    !isObject(input) ||
    !Array.isArray(input.groups) ||
    input.groups.length === 0 ||
    input.groups.length > MAX_GROUPS_IN_FILE
  )
    return invalid();
  const total = (input.groups as unknown[]).reduce<number>((sum, g) => {
    if (!isObject(g)) return sum;
    const length = (v: unknown) => (Array.isArray(v) ? v.length : 0);
    return sum + length(g.expenses) + length(g.payments) + length(g.comments);
  }, 0);
  if (total > MAX_ROWS_IN_IMPORT) return invalid();
  const taken = await new RateLimiter(database).take(`import:${who.accountId}`, IMPORT_RATE);
  if (!taken.ok)
    throw new OpError('rate_limited', 'That is a lot of imports in an hour. Try again later.');
  const seen = new Set<string>();
  const groups = (input.groups as unknown[]).map((g) => checkGroup(g, seen));
  const t = tables(database);
  await transaction(database, async (tx) => {
    const mine = await dbGet<{ n: number }>(
      tx,
      sql`SELECT COUNT(*) AS n FROM ${t.member} WHERE person_id = ${who.personId} AND left_at IS NULL`,
    );
    if (Number(mine?.n ?? 0) + groups.length > MAX_GROUPS)
      throw new OpError(
        'too_many_groups',
        `That would put you in more than ${MAX_GROUPS} groups, which is as many as one person can be in. Nothing was imported.`,
      );
    for (const g of groups) {
      const made = await dbAll<{ id: string }>(
        tx,
        sql`INSERT INTO ${t.grp} (id, sealed, color, default_currency, simplify_debts, closed_at, key_epoch, seq, created_by, created_at, updated_at)
            VALUES (${g.groupId}, ${g.sealed}, ${g.color}, ${g.defaultCurrency}, ${g.simplifyDebts}, NULL, 1, 1, ${who.personId}, ${now}, ${now})
            ON CONFLICT (id) DO NOTHING RETURNING id`,
      );
      if (made.length === 0) throw new OpError('id_taken');
      // Members in their order: the importer as owner, everyone else a placeholder with their name and no email.
      const personOf = new Map<string, string>();
      for (const [i, m] of g.members.entries()) {
        let personId = who.personId;
        if (!m.you) {
          personId = crypto.randomUUID();
          await dbAll(
            tx,
            sql`INSERT INTO ${t.person} (id, account_id, core_sub, name, email, added_by, claimed_at, deleted_at, created_at, updated_at)
                VALUES (${personId}, NULL, NULL, ${m.name}, NULL, ${who.personId}, NULL, NULL, ${now}, ${now}) RETURNING id`,
          );
        }
        personOf.set(m.id, personId);
        await dbAll(
          tx,
          sql`INSERT INTO ${t.member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
              VALUES (${m.id}, ${g.groupId}, ${personId}, ${m.you ? 'owner' : null}, 'all', ${who.personId}, ${now + i}, ${m.left ? now + i : null}, 1)
              RETURNING id`,
        );
      }
      await dbAll(
        tx,
        sql`INSERT INTO ${t.keyWrap} (group_id, epoch, account_id, wrapped, wrapped_by, created_at)
            VALUES (${g.groupId}, 1, ${who.accountId}, ${g.keyWrap}, ${who.accountId}, ${now}) RETURNING group_id`,
      );
      await importGroupRows(
        tx,
        who.personId,
        g.groupId,
        {
          expenses: g.expenses,
          payments: g.payments,
          comments: g.comments.map((c) => ({
            id: c.id,
            subject: c.subject,
            subjectId: c.subjectId,
            authorPersonId: (c.authorMemberId && personOf.get(c.authorMemberId)) || who.personId,
            sealed: c.sealed,
          })),
        },
        1,
        now,
      );
      await recordActivity(tx, {
        groupId: g.groupId,
        actorPersonId: who.personId,
        kind: 'group_created',
        subjectId: g.groupId,
        details: { sealed: g.sealed },
        now,
      });
    }
  });
  return { groups: groups.map((g) => g.groupId) };
}
