import { sql } from 'drizzle-orm';
import { activeMemberOf } from '../access/membership';
import { recordActivity } from '../activity/record';
import { suggestedPayments } from '../balances';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import { tables } from '../db/tables';
import { createInvitationIn } from '../invites/store';
import { formatMoney } from '../money/text';
import { noticeMail, smtpOn } from '../notices/mail';
import { groupRows } from './lifecycle';
import { OpError } from './errors';
import { dayOf, nextReminderAt, waitWords } from './reminder-time';

/**
 * **A reminder** (DESIGN.md §12.4): someone who owes the reader, in a group, nudged. An online operation (`member.remind`), in one transaction:
 *
 *  - **the debt is derived again here,** from the group's rows by its setting (pairwise, or simplified), and the reminder refused unless that member
 *    owes the reader, in that group, now: whatever the button showed;
 *  - **once a day** per (who reminds, who is reminded, group), the day in UTC, held by `reminder`'s unique index, so two at once are one;
 *  - **an account** is told by a notice (`reminder`, and by email unless they turned it off), from a line that is kept out of the group's Activity;
 *  - **a placeholder with an email** is sent their invitation, made anew in the same transaction (its token is never kept), with what they owe said
 *    first; one without an email, or with no mail set up here, cannot be reminded, and the sentence says to invite them.
 *
 * The amounts are in the notice and the email as figures; nothing written in the group is (§5.3).
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

export async function remindMember(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
): Promise<{ reminded: true; until: number; by: 'notice' | 'email' }> {
  const groupId = id(input.groupId);
  const memberId = id(input.memberId);
  const t = tables(database);
  // A placeholder is reached only by Tally's own mail (§12.3): core's email is for people linked to it.
  const notice = noticeMail();
  const mail = smtpOn(notice) ? notice : undefined;
  return transaction(database, async (tx) => {
    // The reader an active member of an open group, and the one reminded an active member of it who is someone else: in the statement.
    const target = await dbGet<{
      personId: string;
      name: string;
      accountId: string | null;
      email: string | null;
      simplify: number | boolean;
      me: string;
      myName: string;
    }>(
      tx,
      sql`SELECT m.person_id AS "personId", p.name, p.account_id AS "accountId", p.email, g.simplify_debts AS simplify,
                 me.id AS me, mp.name AS "myName"
          FROM ${t.member} m JOIN ${t.person} p ON p.id = m.person_id JOIN ${t.grp} g ON g.id = m.group_id
          JOIN ${t.member} me ON me.group_id = m.group_id AND me.person_id = ${who.personId} AND me.left_at IS NULL
          JOIN ${t.person} mp ON mp.id = me.person_id
          WHERE m.id = ${memberId} AND m.group_id = ${groupId} AND m.left_at IS NULL AND m.person_id <> ${who.personId}
            AND g.closed_at IS NULL AND ${activeMemberOf(tx, groupId, who.accountId)}`,
    );
    if (!target) throw new OpError('not_found');

    const { rows, order } = await groupRows(tx, groupId);
    const simplify = target.simplify === true || Number(target.simplify) === 1;
    const owed = suggestedPayments(rows, order, simplify).filter(
      (d) => d.fromId === memberId && d.toId === target.me,
    );
    if (owed.length === 0)
      throw new OpError('not_owed', `${target.name} does not owe you anything in this group.`);

    if (!target.accountId && (!target.email || !mail))
      throw new OpError(
        'cannot_remind',
        !mail
          ? `Mail is not set up here, so ${target.name} cannot be reminded. Send them their invitation link instead.`
          : `${target.name} is not on Tally yet and has no email address here. Invite ${target.name} to remind them.`,
      );

    const taken = await dbAll<{ id: string }>(
      tx,
      sql`INSERT INTO ${t.reminder} (id, group_id, from_person_id, to_member_id, day, created_at)
          VALUES (${crypto.randomUUID()}, ${groupId}, ${who.personId}, ${memberId}, ${dayOf(now)}, ${now})
          ON CONFLICT (group_id, from_person_id, to_member_id, day) DO NOTHING RETURNING id`,
    );
    if (taken.length === 0)
      throw new OpError(
        'already_reminded',
        `You reminded ${target.name} today. You can remind them again ${waitWords(now)}.`,
      );

    const amounts = owed.map((d) => ({ amount: Number(d.amount), currency: d.currency }));
    const [only] = amounts;
    if (target.accountId) {
      await recordActivity(
        tx,
        {
          groupId,
          actorPersonId: who.personId,
          kind: 'member_reminded',
          subjectId: memberId,
          details: {
            memberId,
            personId: target.personId,
            amounts,
            ...(amounts.length === 1 && only
              ? { amount: only.amount, currency: only.currency }
              : {}),
          },
          now,
        },
        [{ personId: target.personId, kind: 'reminder' }],
      );
      return { reminded: true as const, until: nextReminderAt(now), by: 'notice' as const };
    }
    // A placeholder with an address, and mail on: their invitation, anew, with what they owe.
    await createInvitationIn(
      tx,
      who,
      { groupId, personId: target.personId },
      {
        now,
        ...(mail
          ? {
              mail: {
                origin: mail.origin,
                inviterName: target.myName,
                reminder: owed.map((d) => formatMoney(d.amount, d.currency, 'en')).join(' and '),
              },
            }
          : {}),
      },
    );
    return { reminded: true as const, until: nextReminderAt(now), by: 'email' as const };
  });
}
