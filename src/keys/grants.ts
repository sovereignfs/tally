import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, transaction } from '../db/exec';
import { tables } from '../db/tables';
import { activeMemberOf } from '../access/membership';
import { checkWrapped } from './store';

/**
 * **Granting a group's key** (DESIGN.md §5.3): the server tells a device the group keys wrapped to its account, and which of its groups' active members
 * lack a wrap of an epoch it holds (a new member, a claimed placeholder, an account whose key was replaced); the device wraps for them and sends the
 * wraps. **A wrap is taken only from an active member who holds that epoch, for an active member of the same group with an account key**, all
 * checked in the statement that stores it; anything else is not stored and is said to be refused. The server opens none of them.
 */
export interface GroupWrap {
  groupId: string;
  epoch: number;
  wrapped: string;
}

export interface Needed {
  groupId: string;
  epoch: number;
  accountId: string;
  publicKey: string;
}

export interface Grant {
  groupId: string;
  epoch: number;
  accountId: string;
  wrapped: string;
}

/** At most this many grants in one request. */
export const MAX_GRANTS = 200;

/** The group keys wrapped to this account, for the groups it is an active member of. */
export async function myGroupWraps(database: Database, accountId: string): Promise<GroupWrap[]> {
  const t = tables(database);
  return dbAll<GroupWrap>(
    database,
    sql`SELECT kw.group_id AS "groupId", kw.epoch, kw.wrapped FROM ${t.keyWrap} kw
        WHERE kw.account_id = ${accountId} AND ${activeMemberOf(database, sql`kw.group_id`, accountId)}
        ORDER BY kw.group_id, kw.epoch`,
  );
}

/**
 * Who this account's device should wrap for: each active member of a group this account is in and holds an epoch of, who has an account key and no
 * wrap of that epoch. A placeholder has no account and is not here; a member with no key yet is here once they make one.
 */
export async function neededGrants(database: Database, accountId: string): Promise<Needed[]> {
  const t = tables(database);
  return dbAll<Needed>(
    database,
    sql`SELECT mine.group_id AS "groupId", mine.epoch, p.account_id AS "accountId", ak.public_key AS "publicKey"
        FROM ${t.keyWrap} mine
        JOIN ${t.member} m ON m.group_id = mine.group_id AND m.left_at IS NULL
        JOIN ${t.person} p ON p.id = m.person_id AND p.account_id IS NOT NULL AND p.account_id <> ${accountId}
        JOIN ${t.accountKey} ak ON ak.account_id = p.account_id
        WHERE mine.account_id = ${accountId} AND ${activeMemberOf(database, sql`mine.group_id`, accountId)}
          AND NOT EXISTS (SELECT 1 FROM ${t.keyWrap} theirs
                          WHERE theirs.group_id = mine.group_id AND theirs.epoch = mine.epoch AND theirs.account_id = p.account_id)
        ORDER BY mine.group_id, mine.epoch, p.account_id`,
  );
}

/** Stores the grants this account's device made: each one only where the rule holds, in its statement. Says which were taken. */
export async function storeGrants(
  database: Database,
  accountId: string,
  grants: readonly Grant[],
  now = Date.now(),
): Promise<{ accepted: number; refused: number }> {
  if (grants.length > MAX_GRANTS) throw new Error('too many grants');
  const t = tables(database);
  let accepted = 0;
  await transaction(database, async (tx) => {
    for (const grant of grants) {
      checkWrapped(grant.wrapped);
      if (!Number.isSafeInteger(grant.epoch) || grant.epoch < 1) continue;
      const stored = await dbAll<{ groupId: string }>(
        tx,
        sql`INSERT INTO ${t.keyWrap} (group_id, epoch, account_id, wrapped, wrapped_by, created_at)
            SELECT ${grant.groupId}, ${grant.epoch}, ${grant.accountId}, ${grant.wrapped}, ${accountId}, ${now}
            WHERE ${activeMemberOf(tx, grant.groupId, accountId)}
              AND ${activeMemberOf(tx, grant.groupId, grant.accountId)}
              AND EXISTS (SELECT 1 FROM ${t.keyWrap} held
                          WHERE held.group_id = ${grant.groupId} AND held.epoch = ${grant.epoch} AND held.account_id = ${accountId})
              AND EXISTS (SELECT 1 FROM ${t.accountKey} ak WHERE ak.account_id = ${grant.accountId})
            ON CONFLICT (group_id, epoch, account_id) DO NOTHING
            RETURNING group_id AS "groupId"`,
      );
      accepted += stored.length;
    }
  });
  return { accepted, refused: grants.length - accepted };
}
