import { type SQL, sql } from 'drizzle-orm';
import type { ActivityDetailsOf, ActivityKind } from '../activity/kinds';
import type { Database } from '../db/client';
import { dbAll } from '../db/exec';
import { tables } from '../db/tables';
import { enqueueMail } from '../mail/outbox';
import type { NoticeMailData } from '../mail/templates';
import { GROUP_KIND_OF, type NoticeKind, type NoticeRow } from './kinds';
import { noticeMail } from './mail';
import { defaultOn } from './prefs';
import { noticeHref } from './words';

/**
 * **Raising notices** (DESIGN.md §12.2): the one function that writes them, called by `recordActivity` for every line, in the transaction of the change,
 * so that a notice exists exactly when its change does. **Never for the person who acted.** Only people with an account are told (a placeholder cannot
 * sign in to read a bell), and only while they are a member of the group.
 *
 *  - A line of a group's kind (`GROUP_KIND_OF`) is told to every active member by their choice for the group: `all`; `involved` when the line is about
 *    them (they paid or are in the split of the expense, made or received the payment, are on what a comment is on or commented on it before; closing
 *    and reopening involve everyone); `none` never.
 *  - **Email,** where the server sends mail (`mail.ts`) and the person has that kind's email on (`prefs.ts`): a row in the mail outbox in the same
 *    transaction, made of who, a figure and links, never sealed text (§5.3).
 *  - The personal kinds: `added_to_group` to the person added, `edit_replaced` to the author of the version an edit replaced, `owner_passed` to a member
 *    made owner by deletion (a `role_changed` line with no actor), and whatever the caller adds in `tell` (`invite_accepted`, to whoever invited).
 */
export interface Tell {
  personId: string;
  kind: NoticeKind;
}

export async function raiseNotices<K extends ActivityKind>(
  tx: Database,
  line: {
    id: string;
    groupId: string;
    actorPersonId: string | null;
    kind: K;
    subjectId: string | null;
    details: ActivityDetailsOf[K];
    now: number;
  },
  tell: readonly Tell[] = [],
): Promise<void> {
  const personal: Tell[] = [...tell];
  const d = line.details as Record<string, unknown>;
  if (line.kind === 'member_added' && typeof d.personId === 'string')
    personal.push({ personId: d.personId, kind: 'added_to_group' });
  if (line.kind.endsWith('_replaced') && typeof d.replacedPersonId === 'string')
    personal.push({ personId: d.replacedPersonId, kind: 'edit_replaced' });
  if (
    line.kind === 'role_changed' &&
    line.actorPersonId === null &&
    d.role === 'owner' &&
    typeof d.personId === 'string'
  )
    personal.push({ personId: d.personId, kind: 'owner_passed' });

  const mail = await mailContext(tx, line);
  const told = new Set<string>();
  for (const one of personal) {
    if (one.personId === line.actorPersonId || told.has(one.personId)) continue;
    told.add(one.personId);
    await write(tx, line, one.kind, sql`m.person_id = ${one.personId}`, mail);
  }

  const kind = GROUP_KIND_OF[line.kind];
  if (!kind) return;
  const involved = await involvedMembers(tx, line);
  const chosen =
    involved === 'everyone'
      ? sql`m.notify IN ('all', 'involved')`
      : involved.length === 0
        ? sql`m.notify = 'all'`
        : sql`(m.notify = 'all' OR (m.notify = 'involved' AND m.id IN (${sql.join(
            involved.map((id) => sql`${id}`),
            sql`, `,
          )})))`;
  const already =
    told.size === 0
      ? sql`1 = 1`
      : sql`m.person_id NOT IN (${sql.join(
          [...told].map((id) => sql`${id}`),
          sql`, `,
        )})`;
  await write(tx, line, kind, sql`${chosen} AND ${already}`, mail);
}

/** One notice for each active member with an account matching `who`, never the actor, from the group's members in the statement. */
async function write(
  tx: Database,
  line: { id: string; groupId: string; actorPersonId: string | null; now: number },
  kind: NoticeKind,
  who: SQL,
  mail: MailContext | undefined,
) {
  const t = tables(tx);
  const accounts = await dbAll<{ accountId: string; email: number | boolean | null }>(
    tx,
    sql`SELECT p.account_id AS "accountId",
               (SELECT np.enabled FROM ${t.noticePref} np WHERE np.account_id = p.account_id AND np.kind = ${kind} AND np.channel = 'email') AS email
        FROM ${t.member} m JOIN ${t.person} p ON p.id = m.person_id
        WHERE m.group_id = ${line.groupId} AND m.left_at IS NULL AND p.account_id IS NOT NULL
          AND (${line.actorPersonId === null ? sql`1 = 1` : sql`m.person_id <> ${line.actorPersonId}`}) AND ${who}`,
  );
  for (const { accountId, email } of accounts) {
    await dbAll(
      tx,
      sql`INSERT INTO ${t.notice} (id, account_id, group_id, activity_id, kind, read_at, dismissed_at, created_at)
          VALUES (${crypto.randomUUID()}, ${accountId}, ${line.groupId}, ${line.id}, ${kind}, NULL, NULL, ${line.now})
          RETURNING id`,
    );
    const emailOn =
      email === null || email === undefined
        ? defaultOn(kind, 'email')
        : email === true || Number(email) === 1;
    if (mail && emailOn)
      await enqueueMail(
        tx,
        { to: { accountId }, template: 'notice', data: { ...mail.data, kind } },
        line.now,
      );
  }
}

interface MailContext {
  data: Omit<NoticeMailData, 'kind'>;
}

/** What every email of a line carries, when mail is on: who did it (by their name in Tally), its figure, and links. */
async function mailContext(
  tx: Database,
  line: {
    groupId: string;
    actorPersonId: string | null;
    kind: ActivityKind;
    subjectId: string | null;
    details: unknown;
  },
): Promise<MailContext | undefined> {
  const mail = noticeMail();
  if (!mail) return undefined;
  const actor = line.actorPersonId
    ? (
        await dbAll<{ name: string }>(
          tx,
          sql`SELECT name FROM ${tables(tx).person} WHERE id = ${line.actorPersonId}`,
        )
      )[0]?.name
    : undefined;
  const d = line.details as Record<string, unknown>;
  const path = noticeHref({ groupId: line.groupId, line: line as NoticeRow['line'] });
  return {
    data: {
      lineKind: line.kind,
      actorName: actor ?? 'Someone',
      amount: typeof d.amount === 'number' ? d.amount : null,
      currency: typeof d.currency === 'string' ? d.currency : null,
      link: `${mail.origin}${path}`,
      settingsLink: `${mail.origin}/settings?section=notifications`,
    },
  };
}

/** The members a line is about, for those who chose "Only what involves me". */
async function involvedMembers(
  tx: Database,
  line: { groupId: string; kind: ActivityKind; subjectId: string | null; details: unknown },
): Promise<string[] | 'everyone'> {
  if (line.kind === 'group_closed' || line.kind === 'group_reopened') return 'everyone';
  const d = line.details as Record<string, unknown>;
  const ids = new Set<string>();
  const add = (list: unknown) => {
    if (Array.isArray(list))
      for (const item of list as { memberId?: unknown }[])
        if (typeof item?.memberId === 'string') ids.add(item.memberId);
  };
  if (line.kind.startsWith('expense_')) {
    add(d.payers);
    add(d.shares);
  } else if (line.kind.startsWith('payment_')) {
    if (typeof d.fromMemberId === 'string') ids.add(d.fromMemberId);
    if (typeof d.toMemberId === 'string') ids.add(d.toMemberId);
  } else if (line.kind === 'comment_added' && line.subjectId) {
    // Those on what the comment is on, as it is now, and whoever commented on it before.
    const t = tables(tx);
    const on = await dbAll<{ memberId: string }>(
      tx,
      d.subject === 'payment'
        ? sql`SELECT from_member_id AS "memberId" FROM ${t.payment} WHERE id = ${line.subjectId} AND group_id = ${line.groupId}
              UNION SELECT to_member_id AS "memberId" FROM ${t.payment} WHERE id = ${line.subjectId} AND group_id = ${line.groupId}`
        : sql`SELECT member_id AS "memberId" FROM ${t.expensePayer} WHERE expense_id = ${line.subjectId} AND group_id = ${line.groupId}
              UNION SELECT member_id AS "memberId" FROM ${t.expenseShare} WHERE expense_id = ${line.subjectId} AND group_id = ${line.groupId}`,
    );
    for (const row of on) ids.add(row.memberId);
    const before = await dbAll<{ memberId: string }>(
      tx,
      sql`SELECT DISTINCT m.id AS "memberId" FROM ${t.comment} c JOIN ${t.member} m ON m.person_id = c.author_person_id AND m.group_id = c.group_id
          WHERE c.group_id = ${line.groupId} AND c.subject_id = ${line.subjectId} AND c.deleted_at IS NULL`,
    );
    for (const row of before) ids.add(row.memberId);
  }
  return [...ids];
}
