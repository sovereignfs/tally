import { sql } from 'drizzle-orm';
import { activeMemberOf } from '../access/membership';
import type { Database } from '../db/client';
import { dbAll, transaction } from '../db/exec';
import { tables } from '../db/tables';
import { checkWrapped } from './store';

/**
 * **Rotating a group's key** (DESIGN.md §5.3): someone who left must not read what is written after. Leaving or being removed marks the group
 * (`key_rotation_due`); the next remaining member's device to exchange keys is told, makes a new key, wraps it to every remaining member's account key
 * (its own included) and sends the wraps here. The new epoch is taken **only from an active member who holds the current one, only while it is still
 * current and due**, in the statement that moves it on, so that two devices rotating at once make one epoch and the other is told to drop its key.
 * Earlier epochs stay with the remaining members, so earlier text still opens; the server accepts any epoch of the group, so a device that was offline
 * across the rotation loses nothing.
 */
export interface DueRotation {
  groupId: string;
  /** The current epoch, which the new one follows. */
  epoch: number;
  /** Every active member with an account key, this account included: who the new key is wrapped to. */
  members: { accountId: string; publicKey: string }[];
}

export class RotationError extends Error {
  constructor(readonly code: 'invalid' | 'not_current') {
    super(code);
    this.name = 'RotationError';
  }
}

/** The groups this account's device should rotate: due, the account an active member holding the current epoch. */
export async function dueRotations(database: Database, accountId: string): Promise<DueRotation[]> {
  const t = tables(database);
  const groups = await dbAll<{ groupId: string; epoch: number }>(
    database,
    sql`SELECT g.id AS "groupId", g.key_epoch AS epoch FROM ${t.grp} g
        WHERE g.key_rotation_due = ${true} AND ${activeMemberOf(database, sql`g.id`, accountId)}
          AND EXISTS (SELECT 1 FROM ${t.keyWrap} held WHERE held.group_id = g.id AND held.epoch = g.key_epoch AND held.account_id = ${accountId})
        ORDER BY g.id`,
  );
  const due: DueRotation[] = [];
  for (const group of groups) {
    const members = await dbAll<{ accountId: string; publicKey: string }>(
      database,
      sql`SELECT p.account_id AS "accountId", ak.public_key AS "publicKey"
          FROM ${t.member} m JOIN ${t.person} p ON p.id = m.person_id JOIN ${t.accountKey} ak ON ak.account_id = p.account_id
          WHERE m.group_id = ${group.groupId} AND m.left_at IS NULL AND ${activeMemberOf(database, group.groupId, accountId)}
          ORDER BY p.account_id`,
    );
    due.push({ groupId: group.groupId, epoch: Number(group.epoch), members });
  }
  return due;
}

/**
 * Takes a new epoch: the group's `key_epoch` moved on from `fromEpoch` and the flag cleared, in one statement that carries the rule, then the wraps of
 * the new key, each only for an active member with an account key. The rotating account's own wrap must be among them, or nothing is kept.
 */
export async function rotateGroupKey(
  database: Database,
  accountId: string,
  input: { groupId: string; fromEpoch: number; wraps: { accountId: string; wrapped: string }[] },
  now = Date.now(),
): Promise<{ epoch: number }> {
  const { groupId, fromEpoch, wraps } = input;
  if (!Number.isSafeInteger(fromEpoch) || fromEpoch < 1 || wraps.length === 0 || wraps.length > 100)
    throw new RotationError('invalid');
  for (const wrap of wraps) checkWrapped(wrap.wrapped);
  if (!wraps.some((w) => w.accountId === accountId)) throw new RotationError('invalid');
  const t = tables(database);
  return transaction(database, async (tx) => {
    const moved = await dbAll<{ epoch: number }>(
      tx,
      sql`UPDATE ${t.grp} SET key_epoch = key_epoch + 1, key_rotation_due = ${false}, seq = seq + 1, updated_at = ${now}
          WHERE id = ${groupId} AND key_epoch = ${fromEpoch} AND key_rotation_due = ${true}
            AND ${activeMemberOf(tx, groupId, accountId)}
            AND EXISTS (SELECT 1 FROM ${t.keyWrap} held WHERE held.group_id = ${groupId} AND held.epoch = ${fromEpoch} AND held.account_id = ${accountId})
          RETURNING key_epoch AS epoch`,
    );
    const epoch = moved[0]?.epoch;
    // Rotated already by another device, not due, or not this account's to rotate: the device drops the key it made.
    if (epoch === undefined) throw new RotationError('not_current');
    for (const wrap of wraps)
      await dbAll(
        tx,
        sql`INSERT INTO ${t.keyWrap} (group_id, epoch, account_id, wrapped, wrapped_by, created_at)
            SELECT ${groupId}, ${Number(epoch)}, ${wrap.accountId}, ${wrap.wrapped}, ${accountId}, ${now}
            WHERE ${activeMemberOf(tx, groupId, wrap.accountId)}
              AND EXISTS (SELECT 1 FROM ${t.accountKey} ak WHERE ak.account_id = ${wrap.accountId})
            ON CONFLICT (group_id, epoch, account_id) DO NOTHING
            RETURNING group_id`,
      );
    return { epoch: Number(epoch) };
  });
}
