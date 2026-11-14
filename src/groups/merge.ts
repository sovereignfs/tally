import { sql } from 'drizzle-orm';
import { recordActivity } from '../activity/record';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import { tables } from '../db/tables';
import { mergeMemberRows } from '../sync/apply';
import { groupRows, moveSeq } from './lifecycle';
import { OpError } from './errors';

/**
 * **Merging a placeholder into a member** (DESIGN.md §7.2), an owner's operation, for one person who is in a group twice: a placeholder for someone who
 * later joined by other means. In one transaction, with the owner and the group open in the statement that moves the group's `seq` on:
 *
 *  - every expense and payment of the group that names the placeholder is moved to the member (`mergeMemberRows`, in the write path), each with its
 *    revision, so that every balance is what it was with the two added together, and devices pull the rows at their next sync;
 *  - the placeholder's membership ends (its row stays, as a left member's does, so its name stays on the history), its live invitation to the group is
 *    revoked, and the activity says who was merged into whom;
 *  - a placeholder in no other group keeps no email and no invitation; it is deleted once no membership points at it, as a claimed one is
 *    (`src/invites/store.ts`), which its ended membership here does.
 *
 * Only a placeholder is merged, never an account, and only into a current member who is someone else. Anything else reads as not found.
 */
interface Who {
  accountId: string;
  personId: string;
}

const id = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100)
    throw new OpError('invalid');
  return value;
};

export async function mergePlaceholder(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
): Promise<{ merged: true; expenses: number; payments: number }> {
  const groupId = id(input.groupId);
  const fromId = id(input.memberId);
  const intoId = id(input.intoMemberId);
  if (fromId === intoId) throw new OpError('not_found');
  const t = tables(database);
  return transaction(database, async (tx) => {
    const seq = await moveSeq(tx, who, groupId, true, now);
    const from = await dbGet<{ personId: string }>(
      tx,
      sql`SELECT m.person_id AS "personId" FROM ${t.member} m JOIN ${t.person} p ON p.id = m.person_id
          WHERE m.id = ${fromId} AND m.group_id = ${groupId} AND p.account_id IS NULL`,
    );
    const into = await dbGet<{ personId: string }>(
      tx,
      sql`SELECT person_id AS "personId" FROM ${t.member} WHERE id = ${intoId} AND group_id = ${groupId} AND left_at IS NULL`,
    );
    if (!from || !into || from.personId === into.personId) throw new OpError('not_found');

    const { order } = await groupRows(tx, groupId);
    const touched = await mergeMemberRows(
      tx,
      who.personId,
      groupId,
      fromId,
      intoId,
      order,
      seq,
      now,
    );

    await dbAll(
      tx,
      sql`UPDATE ${t.member} SET left_at = COALESCE(left_at, ${now}), role = NULL, seq = ${seq}
          WHERE id = ${fromId} AND group_id = ${groupId} RETURNING id`,
    );
    await dbAll(
      tx,
      sql`UPDATE ${t.invitation} SET revoked_at = ${now}, key_wrap = NULL
          WHERE group_id = ${groupId} AND person_id = ${from.personId} AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
    );
    const elsewhere = await dbGet<{ id: string }>(
      tx,
      sql`SELECT id FROM ${t.member} WHERE person_id = ${from.personId} AND group_id <> ${groupId} AND left_at IS NULL`,
    );
    if (!elsewhere) {
      await dbAll(
        tx,
        sql`UPDATE ${t.invitation} SET revoked_at = ${now}, key_wrap = NULL
            WHERE person_id = ${from.personId} AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
      );
      await dbAll(
        tx,
        sql`UPDATE ${t.person} SET email = NULL, updated_at = ${now} WHERE id = ${from.personId} AND account_id IS NULL RETURNING id`,
      );
    }
    await recordActivity(tx, {
      groupId,
      actorPersonId: who.personId,
      kind: 'member_merged',
      subjectId: intoId,
      details: { memberId: intoId, personId: into.personId, fromPersonId: from.personId },
      now,
    });
    return { merged: true as const, ...touched };
  });
}
