import { getConfig } from '../config/current';
import type { Database } from '../db/client';
import { OpError } from '../groups/errors';
import { personById } from '../people/persons';
import { createInvitation, resendInvitation, revokeInvitation } from './store';

/**
 * The invitation operations of `POST /api/ops` (DESIGN.md §6.3), for any member of a group the placeholder is in: make one (`invite.create`, revoking the
 * one before, mailed when there is an address and mail), revoke it, and send it again (at most once an hour). The answer to `invite.create` carries the
 * token once, for the inviter's device to make the link (adding the key to its fragment, 15.5); the server keeps only its hash.
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

/** Where mail would go from, or nothing: no SMTP, or no address of the app's to make the link from. */
async function mailFor(
  database: Database,
  who: Who,
): Promise<{ origin: string; inviterName: string } | undefined> {
  let config;
  try {
    config = getConfig();
  } catch {
    return undefined;
  }
  if (!config.mail || !config.url) return undefined;
  const inviter = await personById(database, who.personId);
  return { origin: config.url, inviterName: inviter?.name ?? 'Someone' };
}

export async function inviteCreate(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  const mail = await mailFor(database, who);
  const keyWrap =
    typeof input.keyWrap === 'string' && /^w1\.[A-Za-z0-9_-]{40,400}$/.test(input.keyWrap)
      ? input.keyWrap
      : null;
  const made = await createInvitation(
    database,
    who,
    { groupId: id(input.groupId), personId: id(input.personId), keyWrap },
    { now, ...(mail ? { mail } : {}) },
  );
  return {
    token: made.token,
    expiresAt: made.expiresAt,
    mailed: made.mailed,
    mailHeld: made.mailHeld === true,
    mailOn: Boolean(mail),
  };
}

export async function inviteRevoke(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  await revokeInvitation(
    database,
    who,
    { groupId: id(input.groupId), personId: id(input.personId) },
    now,
  );
  return { revoked: true as const };
}

export async function inviteResend(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  const mail = await mailFor(database, who);
  if (!mail)
    throw new OpError('invalid', 'Mail is not set up here: copy the link and send it yourself.');
  return resendInvitation(
    database,
    who,
    { groupId: id(input.groupId), personId: id(input.personId) },
    { now, mail },
  );
}
