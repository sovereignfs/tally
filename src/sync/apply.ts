import { sql } from 'drizzle-orm';
import { activeMemberOf } from '../access/membership';
import { recordActivity } from '../activity/record';
import type { Change, CommentChange, ExpenseRow, Mutation, PaymentRow } from '../actions/types';
import {
  type GroupContext,
  type Refusal,
  checkComment,
  checkExpense,
  checkPayment,
  parseMutation,
} from '../actions/validate';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import { tables } from '../db/tables';
import { toMinor } from '../money/amount';
import { memberOrder } from '../money/split';

/**
 * **The server's one path for a recorded change** (DESIGN.md §11.3–§11.5, §8.5). Expenses, payments and comments are written here and nowhere else.
 *
 * One short transaction per mutation: the group's `seq` is moved on **in a statement that carries the permission** (the account an active member,
 * the group open, §5.2), which also serialises the group's writes without holding up any other group; the group's members are read and every change
 * is checked again by the validators the device ran (`src/actions/validate.ts`), against the stored rows; a row of another group reads as not found;
 * then each row is written whole and stamped with the `seq`, its `version` moved on, its `revision` written, and the mutation's id recorded. Anything
 * refused throws inside the transaction, so **a refused mutation writes nothing**; **a replayed one** (its id already recorded for the account) writes
 * nothing and answers as before.
 *
 * Conflicts are resolved by rule (§11.4): the edit that reaches the server later stands whole, and the stored version it overwrote, when it was based
 * on an older one, is kept as `replaced`; an edit of a deleted row restores it; deleting what is deleted, or restoring what is not, changes nothing.
 */

export interface Actor {
  accountId: string;
  personId: string;
}

export type Applied =
  { status: 'applied'; seq: number; replayed: boolean } | { status: 'refused'; refusal: Refusal };

/** A refusal inside the transaction: thrown to roll it back, caught to answer. */
class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.code);
    this.name = 'Refused';
  }
}

const refuse = (refusal: Refusal | Refusal['code']): never => {
  throw new Refused(typeof refusal === 'string' ? { code: refusal } : refusal);
};

/** Applies one mutation as `actor`. `raw` is what arrived, checked here before anything is read. */
export async function applyMutation(
  database: Database,
  actor: Actor,
  raw: unknown,
  now = Date.now(),
): Promise<Applied> {
  const parsed = parseMutation(raw);
  if (!parsed.ok) return { status: 'refused', refusal: parsed.refusal };
  const mutation = parsed.value;
  try {
    return await transaction(database, (tx) => applyIn(tx, actor, mutation, now));
  } catch (error) {
    if (error instanceof Refused) return { status: 'refused', refusal: error.refusal };
    throw error;
  }
}

interface StoredVersion {
  groupId: string;
  version: number;
  deletedAt: number | null;
  updatedBy: string;
}

async function applyIn(
  tx: Database,
  actor: Actor,
  mutation: Mutation,
  now: number,
): Promise<Applied> {
  const t = tables(tx);
  const { groupId } = mutation;

  // Sent before: the same answer, and nothing written.
  const before = await dbGet<{ groupId: string; seq: number }>(
    tx,
    sql`SELECT group_id AS "groupId", seq FROM ${t.appliedMutation} WHERE account_id = ${actor.accountId} AND id = ${mutation.mutationId}`,
  );
  if (before) {
    if (before.groupId !== groupId) refuse('malformed');
    return { status: 'applied', seq: Number(before.seq), replayed: true };
  }

  // The permission and the order, in one statement.
  const moved = await dbAll<{ seq: number; keyEpoch: number }>(
    tx,
    sql`UPDATE ${t.grp} SET seq = seq + 1, updated_at = ${now}
        WHERE id = ${groupId} AND closed_at IS NULL AND ${activeMemberOf(tx, groupId, actor.accountId)}
        RETURNING seq, key_epoch AS "keyEpoch"`,
  );
  const group = moved[0];
  if (!group) return refuse(await whyNot(tx, actor, groupId));
  const seq = Number(group.seq);

  const members = await dbAll<{ id: string; joinedAt: number; leftAt: number | null }>(
    tx,
    sql`SELECT id, joined_at AS "joinedAt", left_at AS "leftAt" FROM ${t.member} WHERE group_id = ${groupId}`,
  );
  const context: GroupContext = {
    order: memberOrder(members.map((m) => ({ id: m.id, joinedAt: Number(m.joinedAt) }))),
    active: new Set(members.filter((m) => m.leftAt === null).map((m) => m.id)),
    epoch: Number(group.keyEpoch),
  };

  for (const change of mutation.changes) {
    if (change.table === 'comment')
      await applyComment(tx, actor, groupId, change, context, seq, now);
    else await applyRecord(tx, actor, groupId, change, context, seq, now);
  }

  await dbAll(
    tx,
    sql`INSERT INTO ${t.appliedMutation} (account_id, id, group_id, seq, created_at)
        VALUES (${actor.accountId}, ${mutation.mutationId}, ${groupId}, ${seq}, ${now}) RETURNING id`,
  );
  return { status: 'applied', seq, replayed: false };
}

/**
 * Why the group could not be written, said only as far as the account may know: closed, to a member; no longer in it, to someone who was; not found
 * to anyone else.
 */
async function whyNot(tx: Database, actor: Actor, groupId: string): Promise<Refusal['code']> {
  const t = tables(tx);
  const seen = await dbGet<{
    closedAt: number | null;
    active: number | boolean;
    was: number | boolean;
  }>(
    tx,
    sql`SELECT g.closed_at AS "closedAt",
               ${activeMemberOf(tx, groupId, actor.accountId)} AS active,
               EXISTS (SELECT 1 FROM ${t.member} wm JOIN ${t.person} wp ON wp.id = wm.person_id
                        WHERE wm.group_id = ${groupId} AND wp.account_id = ${actor.accountId}) AS was
        FROM ${t.grp} g WHERE g.id = ${groupId}`,
  );
  // SQLite answers 0 or 1, PostgreSQL a boolean.
  const yes = (value: number | boolean) => value === true || Number(value) === 1;
  if (!seen) return 'not_found';
  if (yes(seen.active) && seen.closedAt !== null) return 'closed';
  if (yes(seen.was)) return 'not_in_group';
  return 'not_found';
}

type RecordChange = Exclude<Change, CommentChange>;

/** An expense or a payment: put (create or edit, whole), delete or restore. */
async function applyRecord(
  tx: Database,
  actor: Actor,
  groupId: string,
  change: RecordChange,
  context: GroupContext,
  seq: number,
  now: number,
) {
  const t = tables(tx);
  const table = change.table === 'expense' ? t.expense : t.payment;
  const stored = await dbGet<StoredVersion>(
    tx,
    sql`SELECT group_id AS "groupId", version, deleted_at AS "deletedAt", updated_by AS "updatedBy" FROM ${table} WHERE id = ${change.id}`,
  );
  // Another group's row, named here, is not there.
  if (stored && stored.groupId !== groupId) refuse('not_found');

  if (change.op !== 'put') {
    if (!stored) return refuse('not_found');
    const deleting = change.op === 'delete';
    // Both deleted, or restored twice: nothing to do, and nothing lost.
    if (deleting === (stored.deletedAt !== null)) return;
    const version = Number(stored.version) + 1;
    await dbAll(
      tx,
      sql`UPDATE ${table} SET deleted_at = ${deleting ? now : null}, version = ${version}, updated_by = ${actor.personId},
            seq = ${seq}, updated_at = ${now}
          WHERE id = ${change.id} AND group_id = ${groupId} RETURNING id`,
    );
    await writeRevision(
      tx,
      actor.personId,
      groupId,
      change.table,
      change.id,
      version,
      change.op === 'delete' ? 'deleted' : 'restored',
      now,
    );
    await recordChange(
      tx,
      actor,
      groupId,
      change.table,
      change.id,
      deleting ? 'deleted' : 'restored',
      now,
    );
    return;
  }

  if (change.baseVersion === null && stored) refuse('malformed');
  if (change.baseVersion !== null && !stored) refuse('not_found');
  const onVersion = stored ? await membersOn(tx, change.table, change.id) : new Set<string>();

  if (change.table === 'expense') {
    const checked = checkExpense(change.row, context, onVersion);
    if (!checked.ok) return refuse(checked.refusal);
    await writeExpense(tx, actor, groupId, change.id, checked.value, stored, seq, now);
  } else {
    const checked = checkPayment(change.row, context, onVersion);
    if (!checked.ok) return refuse(checked.refusal);
    await writePayment(tx, actor, groupId, change.id, checked.value, stored, seq, now);
  }

  const version = stored ? Number(stored.version) + 1 : 1;
  if (stored && change.baseVersion !== null && change.baseVersion < Number(stored.version)) {
    // Two edits from one base: this one stands, and the version it overwrote, which its author had and this one's author had not seen, is kept as
    // replaced, under that author's name, so that they can be told and restore it.
    await writeRevision(
      tx,
      stored.updatedBy,
      groupId,
      change.table,
      change.id,
      Number(stored.version),
      'replaced',
      now,
    );
  }
  const kind = !stored ? 'created' : stored.deletedAt !== null ? 'restored' : 'edited';
  await writeRevision(tx, actor.personId, groupId, change.table, change.id, version, kind, now);
  const replaced =
    stored &&
    stored.deletedAt === null &&
    change.baseVersion !== null &&
    change.baseVersion < Number(stored.version);
  await recordChange(
    tx,
    actor,
    groupId,
    change.table,
    change.id,
    !stored ? 'added' : stored.deletedAt !== null ? 'restored' : replaced ? 'replaced' : 'edited',
    now,
    replaced ? stored.updatedBy : undefined,
  );
}

/**
 * The activity line of a change to an expense or a payment (§12.1), from the row as now written: its figures and its sealed text as they travelled,
 * and for a replaced version, whose it was.
 */
async function recordChange(
  tx: Database,
  actor: Actor,
  groupId: string,
  table: 'expense' | 'payment',
  id: string,
  what: 'added' | 'edited' | 'deleted' | 'restored' | 'replaced',
  now: number,
  replacedPersonId?: string,
) {
  const row = JSON.parse(await snapshotOf(tx, table, id)) as Record<string, unknown>;
  const extra = replacedPersonId ? { replacedPersonId } : {};
  const base = { groupId, actorPersonId: actor.personId, subjectId: id, now };
  if (table === 'expense') {
    await recordActivity(tx, {
      ...base,
      kind: `expense_${what}`,
      details: {
        sealed: String(row.sealed),
        amount: Number(row.amount),
        currency: String(row.currency),
        payers: (row.payers as { memberId: string; amount: number }[]) ?? [],
        shares: ((row.shares as { memberId: string; amount: number }[]) ?? []).map((s) => ({
          memberId: s.memberId,
          amount: s.amount,
        })),
        ...extra,
      },
    });
    return;
  }
  await recordActivity(tx, {
    ...base,
    kind: `payment_${what}`,
    details: {
      fromMemberId: String(row.fromMemberId),
      toMemberId: String(row.toMemberId),
      amount: Number(row.amount),
      currency: String(row.currency),
      ...extra,
    },
  });
}

/** The members on the stored version of a row, who may stay on it though they have left the group. */
async function membersOn(
  tx: Database,
  table: 'expense' | 'payment',
  id: string,
): Promise<Set<string>> {
  const t = tables(tx);
  if (table === 'payment') {
    const row = await dbGet<{ from: string; to: string }>(
      tx,
      sql`SELECT from_member_id AS "from", to_member_id AS "to" FROM ${t.payment} WHERE id = ${id}`,
    );
    return new Set(row ? [row.from, row.to] : []);
  }
  const rows = await dbAll<{ memberId: string }>(
    tx,
    sql`SELECT member_id AS "memberId" FROM ${t.expensePayer} WHERE expense_id = ${id}
        UNION SELECT member_id AS "memberId" FROM ${t.expenseShare} WHERE expense_id = ${id}`,
  );
  return new Set(rows.map((r) => r.memberId));
}

async function writeExpense(
  tx: Database,
  actor: Actor,
  groupId: string,
  id: string,
  row: ExpenseRow,
  stored: StoredVersion | undefined,
  seq: number,
  now: number,
) {
  const t = tables(tx);
  if (!stored) {
    await dbAll(
      tx,
      sql`INSERT INTO ${t.expense} (id, group_id, amount, currency, date, category, sealed, method, version, created_by, updated_by, deleted_at, seq, created_at, updated_at)
          VALUES (${id}, ${groupId}, ${row.amount}, ${row.currency}, ${row.date}, ${row.category}, ${row.sealed}, ${row.method}, 1, ${actor.personId},
                  ${actor.personId}, NULL, ${seq}, ${now}, ${now})
          RETURNING id`,
    );
  } else {
    await dbAll(
      tx,
      sql`UPDATE ${t.expense} SET amount = ${row.amount}, currency = ${row.currency}, date = ${row.date}, category = ${row.category},
            sealed = ${row.sealed}, method = ${row.method}, version = ${Number(stored.version) + 1}, updated_by = ${actor.personId},
            deleted_at = NULL, seq = ${seq}, updated_at = ${now}
          WHERE id = ${id} AND group_id = ${groupId} RETURNING id`,
    );
    await dbAll(
      tx,
      sql`DELETE FROM ${t.expensePayer} WHERE expense_id = ${id} AND group_id = ${groupId} RETURNING expense_id`,
    );
    await dbAll(
      tx,
      sql`DELETE FROM ${t.expenseShare} WHERE expense_id = ${id} AND group_id = ${groupId} RETURNING expense_id`,
    );
  }
  for (const payer of row.payers)
    await dbAll(
      tx,
      sql`INSERT INTO ${t.expensePayer} (expense_id, member_id, group_id, amount) VALUES (${id}, ${payer.memberId}, ${groupId}, ${payer.amount})
          RETURNING expense_id`,
    );
  for (const share of row.shares)
    await dbAll(
      tx,
      sql`INSERT INTO ${t.expenseShare} (expense_id, member_id, group_id, amount, units)
          VALUES (${id}, ${share.memberId}, ${groupId}, ${share.amount}, ${share.units}) RETURNING expense_id`,
    );
}

async function writePayment(
  tx: Database,
  actor: Actor,
  groupId: string,
  id: string,
  row: PaymentRow,
  stored: StoredVersion | undefined,
  seq: number,
  now: number,
) {
  const t = tables(tx);
  if (!stored) {
    await dbAll(
      tx,
      sql`INSERT INTO ${t.payment} (id, group_id, from_member_id, to_member_id, amount, currency, date, sealed, version, created_by, updated_by, deleted_at, seq, created_at, updated_at)
          VALUES (${id}, ${groupId}, ${row.fromMemberId}, ${row.toMemberId}, ${row.amount}, ${row.currency}, ${row.date}, ${row.sealed}, 1,
                  ${actor.personId}, ${actor.personId}, NULL, ${seq}, ${now}, ${now})
          RETURNING id`,
    );
    return;
  }
  await dbAll(
    tx,
    sql`UPDATE ${t.payment} SET from_member_id = ${row.fromMemberId}, to_member_id = ${row.toMemberId}, amount = ${row.amount},
          currency = ${row.currency}, date = ${row.date}, sealed = ${row.sealed}, version = ${Number(stored.version) + 1},
          updated_by = ${actor.personId}, deleted_at = NULL, seq = ${seq}, updated_at = ${now}
        WHERE id = ${id} AND group_id = ${groupId} RETURNING id`,
  );
}

/** A row as its revision keeps it: the stored row, its sealed text still sealed. */
async function snapshotOf(tx: Database, table: 'expense' | 'payment', id: string): Promise<string> {
  const t = tables(tx);
  if (table === 'payment') {
    const row = await dbGet<Record<string, unknown>>(
      tx,
      sql`SELECT from_member_id AS "fromMemberId", to_member_id AS "toMemberId", amount, currency, date, sealed, deleted_at AS "deletedAt"
          FROM ${t.payment} WHERE id = ${id}`,
    );
    return JSON.stringify({ ...row, amount: toMinor(Number(row?.amount)) });
  }
  const row = await dbGet<Record<string, unknown>>(
    tx,
    sql`SELECT amount, currency, date, category, sealed, method, deleted_at AS "deletedAt" FROM ${t.expense} WHERE id = ${id}`,
  );
  const payers = await dbAll<{ memberId: string; amount: number }>(
    tx,
    sql`SELECT member_id AS "memberId", amount FROM ${t.expensePayer} WHERE expense_id = ${id} ORDER BY member_id`,
  );
  const shares = await dbAll<{ memberId: string; amount: number; units: number | null }>(
    tx,
    sql`SELECT member_id AS "memberId", amount, units FROM ${t.expenseShare} WHERE expense_id = ${id} ORDER BY member_id`,
  );
  const number = (value: unknown) => (value === null ? null : Number(value));
  return JSON.stringify({
    ...row,
    amount: number(row?.amount),
    deletedAt: number(row?.deletedAt),
    payers: payers.map((p) => ({ memberId: p.memberId, amount: Number(p.amount) })),
    shares: shares.map((s) => ({
      memberId: s.memberId,
      amount: Number(s.amount),
      units: number(s.units),
    })),
  });
}

async function writeRevision(
  tx: Database,
  actorPersonId: string,
  groupId: string,
  subject: 'expense' | 'payment',
  subjectId: string,
  version: number,
  kind: 'created' | 'edited' | 'deleted' | 'restored' | 'replaced',
  now: number,
) {
  const t = tables(tx);
  // A replaced version is the one stored before this change, and so its snapshot is read before the row is written; every other revision is of the
  // row as now written. The caller orders them so.
  const snapshot =
    kind === 'replaced'
      ? await previousSnapshot(tx, subjectId, version)
      : await snapshotOf(tx, subject, subjectId);
  await dbAll(
    tx,
    sql`INSERT INTO ${t.revision} (id, group_id, subject, subject_id, version, kind, snapshot, actor_person_id, created_at)
        VALUES (${crypto.randomUUID()}, ${groupId}, ${subject}, ${subjectId}, ${version}, ${kind}, ${snapshot}, ${actorPersonId}, ${now})
        RETURNING id`,
  );
}

/** The snapshot of a version as its own revision kept it. */
async function previousSnapshot(tx: Database, subjectId: string, version: number): Promise<string> {
  const t = tables(tx);
  const row = await dbGet<{ snapshot: string }>(
    tx,
    sql`SELECT snapshot FROM ${t.revision} WHERE subject_id = ${subjectId} AND version = ${version} AND kind <> 'replaced'
        ORDER BY created_at DESC LIMIT 1`,
  );
  return row?.snapshot ?? '{}';
}

/**
 * A comment (§8.6): made by the account's person on an expense or payment of the same group (a deleted one too: it shows if that is restored, §11.4),
 * or deleted by its author alone. Deleting what is deleted changes nothing. The group being open was carried by the `seq` statement.
 */
async function applyComment(
  tx: Database,
  actor: Actor,
  groupId: string,
  change: CommentChange,
  context: GroupContext,
  seq: number,
  now: number,
): Promise<void> {
  const t = tables(tx);
  const stored = await dbGet<{ groupId: string; author: string; deletedAt: number | null }>(
    tx,
    sql`SELECT group_id AS "groupId", author_person_id AS author, deleted_at AS "deletedAt" FROM ${t.comment} WHERE id = ${change.id}`,
  );
  if (stored && stored.groupId !== groupId) refuse('not_found');

  if (change.op === 'delete') {
    if (!stored) return refuse('not_found');
    if (stored.author !== actor.personId) return refuse('not_author');
    if (stored.deletedAt !== null) return;
    await dbAll(
      tx,
      sql`UPDATE ${t.comment} SET deleted_at = ${now}, seq = ${seq}
          WHERE id = ${change.id} AND group_id = ${groupId} AND author_person_id = ${actor.personId} RETURNING id`,
    );
    return;
  }

  if (stored) refuse('malformed');
  const checked = checkComment(change.row, context);
  if (!checked.ok) return refuse(checked.refusal);
  const subject = checked.value.subject === 'expense' ? t.expense : t.payment;
  const made = await dbAll<{ id: string }>(
    tx,
    sql`INSERT INTO ${t.comment} (id, group_id, subject, subject_id, author_person_id, sealed, deleted_at, seq, created_at)
        SELECT ${change.id}, ${groupId}, ${checked.value.subject}, ${checked.value.subjectId}, ${actor.personId}, ${checked.value.sealed}, NULL,
               ${seq}, ${now}
        WHERE EXISTS (SELECT 1 FROM ${subject} s WHERE s.id = ${checked.value.subjectId} AND s.group_id = ${groupId})
        RETURNING id`,
  );
  // What it is on is the group's, in the same statement, or it is not there.
  if (made.length === 0) refuse('not_found');
  const on =
    checked.value.subject === 'expense'
      ? await dbGet<{ sealed: string }>(
          tx,
          sql`SELECT sealed FROM ${t.expense} WHERE id = ${checked.value.subjectId} AND group_id = ${groupId}`,
        )
      : undefined;
  await recordActivity(tx, {
    groupId,
    actorPersonId: actor.personId,
    kind: 'comment_added',
    subjectId: checked.value.subjectId,
    details: {
      subject: checked.value.subject,
      sealed: checked.value.sealed,
      subjectSealed: on?.sealed ?? null,
    },
    now,
  });
}
