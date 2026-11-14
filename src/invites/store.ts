import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { activeMemberOf } from '../access/membership';
import { recordActivity } from '../activity/record';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import { tables } from '../db/tables';
import { OpError } from '../groups/errors';
import { enqueueMail } from '../mail/outbox';

/**
 * **Invitations and claiming** (DESIGN.md §6.3). An invitation lets someone take a placeholder's place, with every expense, share and payment it has.
 *
 *  - **The token** is 32 random bytes, given to the inviter once and kept only as its SHA-256 (`token_hash`); a link is checked by its hash, then the
 *    hash compared in constant time. Valid for 14 days, single-use, revocable; **one live per placeholder**, so making a new one revokes the old.
 *  - **Delivered by email** through the outbox when the placeholder has an address and mail is on, and **always available as a link**. An emailed link
 *    never carries the group's key (the server sends it); a copied one may, in its fragment, which the server never sees (15.5).
 *  - **Accepting claims the placeholder** in one transaction: each of its memberships is pointed at the accepting account's person, unless that person is
 *    already in that group (refused for that group, with a sentence; an owner can merge them, §7.2); the placeholder's email is dropped, and it is deleted
 *    once nothing points at it. Each group's `seq` moves on, so devices pull the change.
 *
 * Every invalid link (unknown, expired, used, revoked) reads the same.
 */
export const TOKEN_BYTES = 32;
export const VALID_FOR_MS = 14 * 24 * 60 * 60 * 1000;
export const RESEND_AFTER_MS = 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

interface Who {
  accountId: string;
  personId: string;
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');
const newToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url');

/** The path of an invitation's link, from the app's address; the caller adds the fragment when it carries the key. */
export const invitationPath = (token: string) => `/invite/${token}`;

export interface Made {
  invitationId: string;
  token: string;
  expiresAt: number;
  /** Whether it was put in the outbox to the placeholder's address. */
  mailed: boolean;
}

/**
 * Makes an invitation for a placeholder of a group the inviter is an active member of (any member may, §6.3), revoking the one live before. Mails it when
 * `mail` is given and the placeholder has an address. `keyWrap` is the group key wrapped to the link's secret, made on the inviter's device (15.5).
 */
export async function createInvitation(
  database: Database,
  who: Who,
  input: { groupId: string; personId: string; keyWrap?: string | null },
  options: { now: number; mail?: InvitationMail },
): Promise<Made> {
  return transaction(database, (tx) => createInvitationIn(tx, who, input, options));
}

/** Where an invitation is mailed from, by whom, and for a reminder (DESIGN.md §12.4), what is owed. */
export interface InvitationMail {
  origin: string;
  inviterName: string;
  reminder?: string;
}

/** `createInvitation`, in the caller's transaction: a reminder to a placeholder makes its new link in the reminder's (§12.4). */
export async function createInvitationIn(
  tx: Database,
  who: Who,
  input: { groupId: string; personId: string; keyWrap?: string | null },
  options: { now: number; mail?: InvitationMail },
): Promise<Made> {
  const t = tables(tx);
  const token = newToken();
  const invitationId = crypto.randomUUID();
  const expiresAt = options.now + VALID_FOR_MS;
  {
    // The placeholder is in the group, and the inviter an active member of it: both in the statement that finds it.
    const placeholder = await dbGet<{ email: string | null }>(
      tx,
      sql`SELECT p.email FROM ${t.person} p JOIN ${t.member} m ON m.person_id = p.id
          WHERE p.id = ${input.personId} AND p.account_id IS NULL AND p.deleted_at IS NULL
            AND m.group_id = ${input.groupId} AND m.left_at IS NULL
            AND EXISTS (SELECT 1 FROM ${t.grp} g WHERE g.id = ${input.groupId} AND g.closed_at IS NULL)
            AND ${activeMemberOf(tx, input.groupId, who.accountId)}`,
    );
    if (!placeholder) throw new OpError('not_found');
    await dbAll(
      tx,
      sql`UPDATE ${t.invitation} SET revoked_at = ${options.now}, key_wrap = NULL
          WHERE person_id = ${input.personId} AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
    );
    const mailed = Boolean(options.mail && placeholder.email);
    await dbAll(
      tx,
      sql`INSERT INTO ${t.invitation} (id, group_id, person_id, token_hash, email, key_wrap, created_by, expires_at, sent_at, accepted_by, accepted_at, revoked_at, created_at)
          VALUES (${invitationId}, ${input.groupId}, ${input.personId}, ${hashToken(token)}, ${placeholder.email}, ${input.keyWrap ?? null},
                  ${who.personId}, ${expiresAt}, ${mailed ? options.now : null}, NULL, NULL, NULL, ${options.now})
          RETURNING id`,
    );
    if (mailed && options.mail && placeholder.email)
      await enqueueMail(
        tx,
        {
          to: { address: placeholder.email },
          template: 'invitation',
          data: {
            inviterName: options.mail.inviterName,
            link: `${options.mail.origin}${invitationPath(token)}`,
            ...(options.mail.reminder ? { reminder: options.mail.reminder } : {}),
          },
        },
        options.now,
      );
    return { invitationId, token, expiresAt, mailed };
  }
}

/** Revokes a placeholder's live invitation, for a member of the group it is in. */
export async function revokeInvitation(
  database: Database,
  who: Who,
  input: { groupId: string; personId: string },
  now: number,
) {
  const t = tables(database);
  const done = await dbAll<{ id: string }>(
    database,
    sql`UPDATE ${t.invitation} SET revoked_at = ${now}, key_wrap = NULL
        WHERE group_id = ${input.groupId} AND person_id = ${input.personId} AND accepted_at IS NULL AND revoked_at IS NULL
          AND ${activeMemberOf(database, input.groupId, who.accountId)}
        RETURNING id`,
  );
  if (done.length === 0) throw new OpError('not_found');
}

/**
 * Sends a placeholder's invitation again, at most once an hour. The token is never kept, so the link is made anew and the old one stops working; what
 * the person receives is the same invitation, by the same inviter, to the same place.
 */
export async function resendInvitation(
  database: Database,
  who: Who,
  input: { groupId: string; personId: string },
  options: { now: number; mail: { origin: string; inviterName: string } },
): Promise<{ expiresAt: number }> {
  const t = tables(database);
  const live = await dbGet<{ sentAt: number | null; keyWrap: string | null }>(
    database,
    sql`SELECT sent_at AS "sentAt", key_wrap AS "keyWrap" FROM ${t.invitation}
        WHERE group_id = ${input.groupId} AND person_id = ${input.personId} AND accepted_at IS NULL AND revoked_at IS NULL
          AND ${activeMemberOf(database, input.groupId, who.accountId)}`,
  );
  if (!live) throw new OpError('not_found');
  if (live.sentAt !== null && Number(live.sentAt) > options.now - RESEND_AFTER_MS)
    throw new OpError(
      'rate_limited',
      'It was sent less than an hour ago. Send it again later, or copy the link.',
    );
  // An emailed link never carries the key, so the new one has none either.
  const made = await createInvitation(database, who, { ...input, keyWrap: null }, options);
  if (!made.mailed) throw new OpError('invalid', 'This person has no email address to send it to.');
  return { expiresAt: made.expiresAt };
}

export interface Valid {
  invitationId: string;
  groupId: string;
  personId: string;
  inviterName: string;
  keyWrap: string | null;
  /** The group's sealed name, which the page opens only with the key the link's fragment unwraps (15.5). */
  groupSealed: string;
}

/** What a link opens, if it is a live invitation: nothing for anything else, whatever the reason, so every invalid link reads the same. */
export async function validInvitation(
  database: Database,
  token: string,
  now: number,
): Promise<Valid | undefined> {
  if (!TOKEN.test(token)) return undefined;
  const hash = hashToken(token);
  const t = tables(database);
  const row = await dbGet<{
    id: string;
    groupId: string;
    personId: string;
    tokenHash: string;
    inviterName: string;
    keyWrap: string | null;
    groupSealed: string;
  }>(
    database,
    sql`SELECT i.id, i.group_id AS "groupId", i.person_id AS "personId", i.token_hash AS "tokenHash", i.key_wrap AS "keyWrap", c.name AS "inviterName",
               g.sealed AS "groupSealed"
        FROM ${t.invitation} i JOIN ${t.person} c ON c.id = i.created_by JOIN ${t.grp} g ON g.id = i.group_id
        WHERE i.token_hash = ${hash} AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ${now}`,
  );
  if (!row || !timingSafeEqual(Buffer.from(row.tokenHash, 'hex'), Buffer.from(hash, 'hex')))
    return undefined;
  return {
    invitationId: row.id,
    groupId: row.groupId,
    personId: row.personId,
    inviterName: row.inviterName,
    keyWrap: row.keyWrap,
    groupSealed: row.groupSealed,
  };
}

export interface Claimed {
  /** The group the invitation was to, where the person is taken after. */
  groupId: string;
  /** Groups the placeholder was in that the account was already in: not claimed there, said in a sentence. */
  refused: string[];
}

/** Accepts an invitation as the signed-in account: the claim, in one transaction (§6.3). Not found for any link that is not a live invitation. */
export async function acceptInvitation(
  database: Database,
  who: Who,
  token: string,
  now: number,
  selfWrap?: { epoch: number; wrapped: string },
): Promise<Claimed> {
  if (!TOKEN.test(token)) throw new OpError('not_found');
  const t = tables(database);
  return transaction(database, async (tx) => {
    // Whether the link carried the key (15.5): only then is a wrap of it to the claimer's own account key taken with the claim.
    const carried = await dbGet<{ keyWrap: string | null }>(
      tx,
      sql`SELECT key_wrap AS "keyWrap" FROM ${t.invitation} WHERE token_hash = ${hashToken(token)}`,
    );
    // Used, and so used once: the statement that marks it holds that it is live.
    const taken = await dbAll<{ groupId: string; personId: string; createdBy: string }>(
      tx,
      sql`UPDATE ${t.invitation} SET accepted_by = ${who.personId}, accepted_at = ${now}, key_wrap = NULL
          WHERE token_hash = ${hashToken(token)} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ${now}
          RETURNING group_id AS "groupId", person_id AS "personId", created_by AS "createdBy"`,
    );
    const invitation = taken[0];
    if (!invitation) throw new OpError('not_found');
    const placeholderId = invitation.personId;
    const memberships = await dbAll<{ id: string; groupId: string; leftAt: number | null }>(
      tx,
      sql`SELECT id, group_id AS "groupId", left_at AS "leftAt" FROM ${t.member} WHERE person_id = ${placeholderId}`,
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
        m.groupId === invitation.groupId
          ? [{ personId: invitation.createdBy, kind: 'invite_accepted' }]
          : [],
      );
    }
    if (refused.includes(invitation.groupId))
      throw new OpError(
        'already_member',
        'You are in that group already. An owner can merge the two of you.',
      );
    // The placeholder's address goes; the placeholder goes once nothing points at it, and its other invitations with it.
    await dbAll(
      tx,
      sql`UPDATE ${t.person} SET email = NULL, updated_at = ${now} WHERE id = ${placeholderId} RETURNING id`,
    );
    if (refused.length === 0) {
      await dbAll(
        tx,
        sql`UPDATE ${t.invitation} SET revoked_at = ${now}, key_wrap = NULL WHERE person_id = ${placeholderId} AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
      );
      await dbAll(
        tx,
        sql`DELETE FROM ${t.person} WHERE id = ${placeholderId} AND NOT EXISTS (SELECT 1 FROM ${t.member} m WHERE m.person_id = ${placeholderId}) RETURNING id`,
      );
    }
    // The group's key, opened on the claimer's device from the link's fragment and wrapped to their own account key, kept with the claim, so the group
    // opens on every device of theirs at once. A wrap that is not in the wrapped form is not kept.
    if (
      selfWrap &&
      carried?.keyWrap &&
      /^h1\.[A-Za-z0-9_-]{40,2000}$/.test(selfWrap.wrapped) &&
      Number.isSafeInteger(selfWrap.epoch) &&
      selfWrap.epoch >= 1
    )
      await dbAll(
        tx,
        sql`INSERT INTO ${t.keyWrap} (group_id, epoch, account_id, wrapped, wrapped_by, created_at)
            SELECT ${invitation.groupId}, ${selfWrap.epoch}, ${who.accountId}, ${selfWrap.wrapped}, ${who.accountId}, ${now}
            WHERE EXISTS (SELECT 1 FROM ${t.grp} g WHERE g.id = ${invitation.groupId} AND g.key_epoch >= ${selfWrap.epoch})
            ON CONFLICT (group_id, epoch, account_id) DO NOTHING
            RETURNING group_id`,
      );
    return { groupId: invitation.groupId, refused };
  });
}
