import { sql } from 'drizzle-orm';
import { recordActivity } from '../activity/record';
import type { Database } from '../db/client';
import { dbAll, dbGet } from '../db/exec';
import { tables } from '../db/tables';
import type { Tell } from '../notices/raise';

/**
 * **An account takes a placeholder's place** (DESIGN.md §6.3, §14.2), in the caller's transaction: by an invitation, or, signing in through core, as
 * the placeholder linked to that `sub` from the directory. Every membership of the placeholder becomes the account's person's, each group's `seq`
 * moved on so that devices pull it, with a `member_joined` line (and whatever `tell` adds, such as `invite_accepted`). A group the account is already
 * in keeps the placeholder there (an owner can merge the two, §7.2) and is returned as refused. The placeholder's address goes; once no membership
 * points at it, its other invitations and the placeholder itself go too.
 */
export async function claimPlaceholder(
  tx: Database,
  placeholderId: string,
  who: { personId: string },
  now: number,
  tell: (groupId: string) => Tell[] = () => [],
): Promise<string[]> {
  const t = tables(tx);
  const memberships = await dbAll<{ id: string; groupId: string }>(
    tx,
    sql`SELECT id, group_id AS "groupId" FROM ${t.member} WHERE person_id = ${placeholderId}`,
  );
  const refused: string[] = [];
  for (const m of memberships) {
    const already = await dbGet<{ id: string }>(
      tx,
      sql`SELECT id FROM ${t.member} WHERE group_id = ${m.groupId} AND person_id = ${who.personId}`,
    );
    if (already) {
      refused.push(m.groupId);
      continue;
    }
    const moved = await dbAll<{ seq: number }>(
      tx,
      sql`UPDATE ${t.grp} SET seq = seq + 1, updated_at = ${now} WHERE id = ${m.groupId} RETURNING seq`,
    );
    const seq = moved[0]?.seq ?? 0;
    await dbAll(
      tx,
      sql`UPDATE ${t.member} SET person_id = ${who.personId}, role = CASE WHEN left_at IS NULL THEN 'member' ELSE role END, seq = ${seq}
          WHERE id = ${m.id} RETURNING id`,
    );
    await recordActivity(
      tx,
      {
        groupId: m.groupId,
        actorPersonId: who.personId,
        kind: 'member_joined',
        subjectId: m.id,
        details: { memberId: m.id, personId: who.personId },
        now,
      },
      tell(m.groupId),
    );
  }
  await dbAll(
    tx,
    sql`UPDATE ${t.person} SET email = NULL, updated_at = ${now} WHERE id = ${placeholderId} RETURNING id`,
  );
  if (refused.length === 0) {
    await dbAll(
      tx,
      sql`UPDATE ${t.invitation} SET revoked_at = ${now}, key_wrap = NULL
          WHERE person_id = ${placeholderId} AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
    );
    await dbAll(
      tx,
      sql`DELETE FROM ${t.person} WHERE id = ${placeholderId} AND account_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM ${t.member} m WHERE m.person_id = ${placeholderId}) RETURNING id`,
    );
  }
  return refused;
}
