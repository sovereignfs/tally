import { sql } from 'drizzle-orm';
import { activeMemberOf } from '../access/membership';
import { recordActivity } from '../activity/record';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import { tables } from '../db/tables';
import { RateLimiter, type Rule } from '../limits/rate';
import { NAME_MAX, cleanName } from '../people/persons';
import { OpError } from './errors';
import { MAX_MEMBERS } from './ops';

/**
 * **Adding people to a group** (DESIGN.md §6.2), an online operation any member may make (§24), in one transaction with the membership in the statement:
 *
 *  - **a person the adder already knows**: someone they share a group with, or a placeholder they added, by its id;
 *  - **an exact email**: the account here that has it, whose person is added (its device is given the group's key by any member's at their next exchange,
 *    §5.3), or else a new placeholder with that email. Telling the two apart tells the adder whether an address has an account here, so it is limited
 *    per account and hour, as Tusk's lookup is;
 *  - **a name alone**: a placeholder with no email ("not on Tally yet").
 *
 * The group's `seq` moves on so that devices pull the new member, and the activity says who was added. Someone already in the group is refused with a
 * sentence; someone who left comes back. A placeholder is renamed, and its email changed, by whoever added it or an owner of a group it is in
 * (`editPlaceholder`).
 */
interface Who {
  accountId: string;
  personId: string;
}

/** Looking up an address, per account and hour. */
export const EMAIL_LOOKUP: Rule = { limit: 30, windowMs: 60 * 60 * 1000 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Added {
  memberId: string;
  personId: string;
  placeholder: boolean;
  /** Whether the added person has an email the adder may see: an invitation can be mailed to it (§6.3). */
  email: string | null;
}

export async function addPerson(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
): Promise<Added> {
  const groupId =
    typeof input.groupId === 'string' && input.groupId.length <= 100 ? input.groupId : '';
  if (!groupId) throw new OpError('invalid');
  const t = tables(database);

  // Who is being added: a known person, an account by its exact email, or a new placeholder.
  let target:
    | { personId: string; placeholder: boolean; email: string | null }
    | { create: { name: string; email: string | null } };
  if (typeof input.personId === 'string') {
    const known = await dbGet<{
      id: string;
      accountId: string | null;
      email: string | null;
      addedBy: string | null;
    }>(
      database,
      sql`SELECT p.id, p.account_id AS "accountId", p.email, p.added_by AS "addedBy" FROM ${t.person} p
          WHERE p.id = ${input.personId} AND p.deleted_at IS NULL
            AND (p.added_by = ${who.personId}
                 OR EXISTS (SELECT 1 FROM ${t.member} theirs JOIN ${t.member} mine ON mine.group_id = theirs.group_id
                            WHERE theirs.person_id = p.id AND mine.person_id = ${who.personId} AND mine.left_at IS NULL))`,
    );
    if (!known) throw new OpError('not_found');
    target = {
      personId: known.id,
      placeholder: known.accountId === null,
      email: known.accountId === null && known.addedBy === who.personId ? known.email : null,
    };
  } else if (typeof input.email === 'string' && input.email.trim() !== '') {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254)
      throw new OpError('invalid', 'That is not an email address.');
    const taken = await new RateLimiter(database).take(
      `add-by-email:${who.accountId}`,
      EMAIL_LOOKUP,
    );
    if (!taken.ok)
      throw new OpError(
        'rate_limited',
        'That is a lot of addresses in an hour. Try again later, or add them by name.',
      );
    const account = await dbGet<{ id: string }>(
      database,
      sql`SELECT id FROM ${t.person} WHERE email = ${email} AND account_id IS NOT NULL AND deleted_at IS NULL`,
    );
    if (account) target = { personId: account.id, placeholder: false, email: null };
    else {
      const name = cleanName(
        typeof input.name === 'string' && input.name.trim()
          ? input.name
          : (email.split('@')[0] ?? email),
      );
      target = { create: { name, email } };
    }
  } else if (typeof input.name === 'string') {
    const name = cleanName(input.name);
    if (!name) throw new OpError('invalid', 'A name is needed.');
    target = { create: { name, email: null } };
  } else throw new OpError('invalid');

  return transaction(database, async (tx) => {
    const moved = await dbAll<{ seq: number }>(
      tx,
      sql`UPDATE ${t.grp} SET seq = seq + 1, updated_at = ${now}
          WHERE id = ${groupId} AND closed_at IS NULL AND ${activeMemberOf(tx, groupId, who.accountId)} RETURNING seq`,
    );
    const seq = moved[0]?.seq;
    if (seq === undefined) throw new OpError('not_found');
    const count = await dbGet<{ n: number }>(
      tx,
      sql`SELECT COUNT(*) AS n FROM ${t.member} WHERE group_id = ${groupId} AND left_at IS NULL`,
    );
    if (Number(count?.n ?? 0) >= MAX_MEMBERS)
      throw new OpError(
        'too_many_members',
        `A group can have ${MAX_MEMBERS} people. Remove someone first.`,
      );

    let personId: string;
    let placeholder: boolean;
    let email: string | null;
    if ('create' in target) {
      personId = crypto.randomUUID();
      placeholder = true;
      email = target.create.email;
      await dbAll(
        tx,
        sql`INSERT INTO ${t.person} (id, account_id, core_sub, name, email, added_by, claimed_at, deleted_at, created_at, updated_at)
            VALUES (${personId}, NULL, NULL, ${target.create.name}, ${email}, ${who.personId}, NULL, NULL, ${now}, ${now}) RETURNING id`,
      );
    } else {
      ({ personId, placeholder, email } = target);
    }

    const existing = await dbGet<{ id: string; leftAt: number | null }>(
      tx,
      sql`SELECT id, left_at AS "leftAt" FROM ${t.member} WHERE group_id = ${groupId} AND person_id = ${personId}`,
    );
    if (existing && existing.leftAt === null)
      throw new OpError('already_member', 'They are in this group already.');
    let memberId: string;
    if (existing) {
      // Someone who left comes back to the same place, with everything they shared.
      memberId = existing.id;
      await dbAll(
        tx,
        sql`UPDATE ${t.member} SET left_at = NULL, role = ${placeholder ? null : 'member'}, seq = ${seq} WHERE id = ${memberId} RETURNING id`,
      );
    } else {
      memberId = crypto.randomUUID();
      await dbAll(
        tx,
        sql`INSERT INTO ${t.member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
            VALUES (${memberId}, ${groupId}, ${personId}, ${placeholder ? null : 'member'}, 'all', ${who.personId}, ${now}, NULL, ${seq})
            RETURNING id`,
      );
    }
    await recordActivity(tx, {
      groupId,
      actorPersonId: who.personId,
      kind: 'member_added',
      subjectId: memberId,
      details: { memberId, personId },
      now,
    });
    return { memberId, personId, placeholder, email };
  });
}

/**
 * **A placeholder renamed, or its email changed** (§6.1), by whoever added it or an owner of a group it is in, decided in the statement. Its name changes
 * everywhere it is; the groups it is in move on, so that devices pull the new name.
 */
export async function editPlaceholder(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
): Promise<{ personId: string }> {
  const personId = typeof input.personId === 'string' ? input.personId : '';
  const name = typeof input.name === 'string' ? cleanName(input.name) : undefined;
  const email =
    input.email === null || input.email === ''
      ? null
      : typeof input.email === 'string'
        ? input.email.trim().toLowerCase()
        : undefined;
  if (!personId || name === '' || (name !== undefined && [...name].length > NAME_MAX))
    throw new OpError('invalid', 'A name is needed.');
  if (email && (!EMAIL.test(email) || email.length > 254))
    throw new OpError('invalid', 'That is not an email address.');
  const t = tables(database);
  await transaction(database, async (tx) => {
    const changed = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${t.person} SET name = COALESCE(${name ?? null}, name), email = ${email === undefined ? sql`email` : email}, updated_at = ${now}
          WHERE id = ${personId} AND account_id IS NULL AND deleted_at IS NULL
            AND (added_by = ${who.personId}
                 OR EXISTS (SELECT 1 FROM ${t.member} pm JOIN ${t.member} om ON om.group_id = pm.group_id
                            JOIN ${t.person} op ON op.id = om.person_id
                            WHERE pm.person_id = ${personId} AND pm.left_at IS NULL
                              AND op.account_id = ${who.accountId} AND om.left_at IS NULL AND om.role = 'owner'))
          RETURNING id`,
    );
    if (changed.length === 0) throw new OpError('not_found');
    // Every group it is in moves on, and its rows carry the new seq, so the devices pull the new name.
    const groups = await dbAll<{ groupId: string }>(
      tx,
      sql`SELECT DISTINCT group_id AS "groupId" FROM ${t.member} WHERE person_id = ${personId}`,
    );
    for (const { groupId } of groups) {
      const moved = await dbAll<{ seq: number }>(
        tx,
        sql`UPDATE ${t.grp} SET seq = seq + 1 WHERE id = ${groupId} RETURNING seq`,
      );
      const seq = moved[0]?.seq;
      if (seq !== undefined)
        await dbAll(
          tx,
          sql`UPDATE ${t.member} SET seq = ${seq} WHERE group_id = ${groupId} AND person_id = ${personId} RETURNING id`,
        );
    }
  });
  return { personId };
}
