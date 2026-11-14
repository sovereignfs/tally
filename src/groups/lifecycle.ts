import { sql } from 'drizzle-orm';
import { ownerOf } from '../access/membership';
import { recordActivity } from '../activity/record';
import { type Balances, type GroupRows, balances } from '../balances';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import { tables } from '../db/tables';
import { type Minor, negateMinor, toMinor } from '../money/amount';
import { memberOrder } from '../money/split';
import { formatMoney } from '../money/text';
import { deleteGroupRows } from '../sovereign/people';
import { OpError } from './errors';

/**
 * **A group's lifecycle** (DESIGN.md §7.3): leaving, removing, closing, reopening and deleting, each an online operation in one short transaction,
 * **guarded by the balances**, which are read through `src/balances/` from the group's rows in that same transaction, so that no expense recorded a
 * moment before can slip past the guard.
 *
 *  - **Leave and remove** are refused while that member's balance in any currency is not zero, with the amounts in the sentence. The membership row
 *    stays (`left_at`), so their name stays on everything past. The last owner cannot leave while someone else with an account is still in the group.
 *  - **Close** is refused while anyone's balance is not zero. A closed group refuses every mutation (`src/sync/apply.ts`) and every operation but reopen.
 *  - **Delete** only a group that has never had an expense or a payment (deleted ones count), every row of it in one transaction.
 *
 * Leaving and removing also make the group due a new key epoch, so that what is written after is sealed under a key the one who left never held;
 * rotating it is its own task (15.6).
 */

interface Who {
  accountId: string;
  personId: string;
}

const string = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100)
    throw new OpError('invalid');
  return value;
};

/** A group's rows as the balances read them, and its member order, inside the caller's transaction. */
export async function groupRows(
  tx: Database,
  groupId: string,
): Promise<{ rows: GroupRows; order: string[] }> {
  const t = tables(tx);
  const members = await dbAll<{ id: string; joinedAt: number }>(
    tx,
    sql`SELECT id, joined_at AS "joinedAt" FROM ${t.member} WHERE group_id = ${groupId}`,
  );
  const expenses = await dbAll<{ id: string; currency: string }>(
    tx,
    sql`SELECT id, currency FROM ${t.expense} WHERE group_id = ${groupId} AND deleted_at IS NULL`,
  );
  const payers = await dbAll<{ expenseId: string; memberId: string; amount: number }>(
    tx,
    sql`SELECT p.expense_id AS "expenseId", p.member_id AS "memberId", p.amount FROM ${t.expensePayer} p
        JOIN ${t.expense} e ON e.id = p.expense_id WHERE p.group_id = ${groupId} AND e.deleted_at IS NULL`,
  );
  const shares = await dbAll<{ expenseId: string; memberId: string; amount: number }>(
    tx,
    sql`SELECT s.expense_id AS "expenseId", s.member_id AS "memberId", s.amount FROM ${t.expenseShare} s
        JOIN ${t.expense} e ON e.id = s.expense_id WHERE s.group_id = ${groupId} AND e.deleted_at IS NULL`,
  );
  const payments = await dbAll<{ fromId: string; toId: string; amount: number; currency: string }>(
    tx,
    sql`SELECT from_member_id AS "fromId", to_member_id AS "toId", amount, currency FROM ${t.payment}
        WHERE group_id = ${groupId} AND deleted_at IS NULL`,
  );
  const byExpense = <T extends { expenseId: string }>(list: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of list) map.set(item.expenseId, [...(map.get(item.expenseId) ?? []), item]);
    return map;
  };
  const payersOf = byExpense(payers);
  const sharesOf = byExpense(shares);
  return {
    order: memberOrder(members.map((m) => ({ id: m.id, joinedAt: Number(m.joinedAt) }))),
    rows: {
      expenses: expenses.map((e) => ({
        currency: e.currency,
        payers: (payersOf.get(e.id) ?? []).map((p) => ({
          memberId: p.memberId,
          amount: toMinor(Number(p.amount)),
        })),
        shares: (sharesOf.get(e.id) ?? []).map((s) => ({
          memberId: s.memberId,
          amount: toMinor(Number(s.amount)),
        })),
      })),
      payments: payments.map((p) => ({
        currency: p.currency,
        fromId: p.fromId,
        toId: p.toId,
        amount: toMinor(Number(p.amount)),
      })),
    },
  };
}

/** A member's balances that are not zero, per currency. */
function unsettled(table: Balances, memberId: string): { currency: string; amount: Minor }[] {
  const out: { currency: string; amount: Minor }[] = [];
  for (const [currency, members] of table) {
    const amount = members.get(memberId);
    if (amount !== undefined && amount !== 0) out.push({ currency, amount });
  }
  return out;
}

/** "owe €12.00 and are owed ¥300" for "You", "owes €12.00 and is owed ¥300" for a name: in English, as the operations' other sentences are. */
function amountsSentence(
  amounts: { currency: string; amount: Minor }[],
  subject: 'you' | 'they',
): string {
  const [owe, owed] = subject === 'you' ? ['owe', 'are owed'] : ['owes', 'is owed'];
  const parts = amounts.map(({ currency, amount }) =>
    amount < 0
      ? `${owe} ${formatMoney(negateMinor(amount), currency, 'en')}`
      : `${owed} ${formatMoney(amount, currency, 'en')}`,
  );
  return parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Moves the group's `seq` on, open and with the account an active member (or owner), in the statement; refuses otherwise as not found. */
async function moveSeq(
  tx: Database,
  who: Who,
  groupId: string,
  owner: boolean,
  now: number,
): Promise<number> {
  const t = tables(tx);
  const condition = owner
    ? ownerOf(tx, groupId, who.accountId)
    : sql`EXISTS (SELECT 1 FROM ${t.member} sm WHERE sm.group_id = ${groupId} AND sm.person_id = ${who.personId} AND sm.left_at IS NULL)`;
  const moved = await dbAll<{ seq: number }>(
    tx,
    sql`UPDATE ${t.grp} SET seq = seq + 1, updated_at = ${now} WHERE id = ${groupId} AND closed_at IS NULL AND ${condition} RETURNING seq`,
  );
  const seq = moved[0]?.seq;
  if (seq === undefined) throw new OpError('not_found');
  return Number(seq);
}

/** **Leaves a group** (§7.3): refused while the reader's balance is not zero, or while they are its last owner and someone else with an account is in it. */
export async function leaveGroup(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  const groupId = string(input.groupId);
  const t = tables(database);
  await transaction(database, async (tx) => {
    const seq = await moveSeq(tx, who, groupId, false, now);
    const me = await dbGet<{ id: string; role: string | null }>(
      tx,
      sql`SELECT id, role FROM ${t.member} WHERE group_id = ${groupId} AND person_id = ${who.personId} AND left_at IS NULL`,
    );
    if (!me) throw new OpError('not_found');
    const { rows, order } = await groupRows(tx, groupId);
    const owing = unsettled(balances(rows, order), me.id);
    if (owing.length > 0)
      throw new OpError(
        'unsettled',
        `You ${amountsSentence(owing, 'you')} in this group. Settle up before you leave.`,
      );
    if (me.role === 'owner') {
      const others = await dbGet<{ owners: number; accounts: number }>(
        tx,
        sql`SELECT
              (SELECT COUNT(*) FROM ${t.member} o WHERE o.group_id = ${groupId} AND o.left_at IS NULL AND o.role = 'owner' AND o.id <> ${me.id}) AS owners,
              (SELECT COUNT(*) FROM ${t.member} a JOIN ${t.person} ap ON ap.id = a.person_id
                WHERE a.group_id = ${groupId} AND a.left_at IS NULL AND ap.account_id IS NOT NULL AND a.id <> ${me.id}) AS accounts`,
      );
      if (Number(others?.owners ?? 0) === 0 && Number(others?.accounts ?? 0) > 0)
        throw new OpError(
          'last_owner',
          'A group always has an owner. Make someone else an owner before you leave.',
        );
    }
    await dbAll(
      tx,
      sql`UPDATE ${t.member} SET left_at = ${now}, role = CASE WHEN role IS NULL THEN NULL ELSE 'member' END, seq = ${seq}
          WHERE id = ${me.id} AND group_id = ${groupId} RETURNING id`,
    );
    await recordActivity(tx, {
      groupId,
      actorPersonId: who.personId,
      kind: 'member_left',
      subjectId: me.id,
      details: { memberId: me.id, personId: who.personId },
      now,
    });
  });
  return { left: true as const };
}

/** **Removes a member** (§7.3), an owner's operation: refused while their balance is not zero. One leaves oneself with `member.leave`. */
export async function removeMember(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  const groupId = string(input.groupId);
  const memberId = string(input.memberId);
  const t = tables(database);
  await transaction(database, async (tx) => {
    const seq = await moveSeq(tx, who, groupId, true, now);
    const target = await dbGet<{ personId: string; name: string }>(
      tx,
      sql`SELECT m.person_id AS "personId", p.name FROM ${t.member} m JOIN ${t.person} p ON p.id = m.person_id
          WHERE m.id = ${memberId} AND m.group_id = ${groupId} AND m.left_at IS NULL`,
    );
    if (!target || target.personId === who.personId) throw new OpError('not_found');
    const { rows, order } = await groupRows(tx, groupId);
    const owing = unsettled(balances(rows, order), memberId);
    if (owing.length > 0)
      throw new OpError(
        'unsettled',
        `${target.name} ${amountsSentence(owing, 'they')} in this group. Settle up before they are removed.`,
      );
    await dbAll(
      tx,
      sql`UPDATE ${t.member} SET left_at = ${now}, role = CASE WHEN role IS NULL THEN NULL ELSE 'member' END, seq = ${seq}
          WHERE id = ${memberId} AND group_id = ${groupId} AND left_at IS NULL RETURNING id`,
    );
    await recordActivity(tx, {
      groupId,
      actorPersonId: who.personId,
      kind: 'member_removed',
      subjectId: memberId,
      details: { memberId, personId: target.personId },
      now,
    });
  });
}

/** **Closes a group** (§7.3), an owner's operation: refused while anyone's balance is not zero. */
export async function closeGroup(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  const groupId = string(input.groupId);
  const t = tables(database);
  await transaction(database, async (tx) => {
    await moveSeq(tx, who, groupId, true, now);
    const { rows, order } = await groupRows(tx, groupId);
    const table = balances(rows, order);
    const people = new Set<string>();
    for (const members of table.values())
      for (const [id, amount] of members) if (amount !== 0) people.add(id);
    if (people.size > 0)
      throw new OpError(
        'unsettled',
        `${people.size === 1 ? 'One person is' : `${people.size} people are`} not settled up. A group is closed once everyone is.`,
      );
    await dbAll(tx, sql`UPDATE ${t.grp} SET closed_at = ${now} WHERE id = ${groupId} RETURNING id`);
    await recordActivity(tx, {
      groupId,
      actorPersonId: who.personId,
      kind: 'group_closed',
      subjectId: groupId,
      details: {},
      now,
    });
  });
}

/** **Reopens a closed group**, an owner's operation: the one operation a closed group takes. */
export async function reopenGroup(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  const groupId = string(input.groupId);
  const t = tables(database);
  await transaction(database, async (tx) => {
    const reopened = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${t.grp} SET closed_at = NULL, seq = seq + 1, updated_at = ${now}
          WHERE id = ${groupId} AND closed_at IS NOT NULL AND ${ownerOf(tx, groupId, who.accountId)} RETURNING id`,
    );
    if (reopened.length === 0) throw new OpError('not_found');
    await recordActivity(tx, {
      groupId,
      actorPersonId: who.personId,
      kind: 'group_reopened',
      subjectId: groupId,
      details: {},
      now,
    });
  });
}

/**
 * **Deletes a group** (§7.3), an owner's operation, only while it has never had an expense or a payment (deleted ones count): the owner and the
 * emptiness are held in the statement that deletes its row, and every other row of it goes by `group_id` in the same transaction.
 */
export async function deleteGroup(database: Database, who: Who, input: Record<string, unknown>) {
  const groupId = string(input.groupId);
  const t = tables(database);
  await transaction(database, async (tx) => {
    const gone = await dbAll<{ id: string }>(
      tx,
      sql`DELETE FROM ${t.grp} WHERE id = ${groupId} AND ${ownerOf(tx, groupId, who.accountId)}
            AND NOT EXISTS (SELECT 1 FROM ${t.expense} e WHERE e.group_id = ${groupId})
            AND NOT EXISTS (SELECT 1 FROM ${t.payment} p WHERE p.group_id = ${groupId})
          RETURNING id`,
    );
    if (gone.length === 0) {
      // Said only to an owner, who knows the group is there.
      const owned = await dbGet<{ id: string }>(
        tx,
        sql`SELECT id FROM ${t.grp} WHERE id = ${groupId} AND ${ownerOf(tx, groupId, who.accountId)}`,
      );
      if (owned)
        throw new OpError(
          'not_empty',
          'A group that has had an expense or a payment is closed, not deleted.',
        );
      throw new OpError('not_found');
    }
    await deleteGroupRows(tx, groupId);
  });
  return { deleted: true as const };
}
