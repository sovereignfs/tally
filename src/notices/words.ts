import { type DescribeContext, describeActivity } from '../activity/describe';
import type { ActivityLine } from '../activity/kinds';
import type { NoticeRow } from './kinds';

/**
 * **A notice in words, and where it goes** (DESIGN.md §12.2). Pure, on the device: a notice is said as the activity line it tells of
 * (`describeActivity`, the text opened with the group's key), with the group's name when the device has it, and the two personal kinds that read
 * differently said for the person told.
 */
export function noticeWords(
  notice: Pick<NoticeRow, 'kind' | 'line'>,
  context: DescribeContext,
  groupName: string | undefined,
): string {
  const line = notice.line as ActivityLine;
  const where = groupName ? ` in ${groupName}` : '';
  if (notice.kind === 'owner_passed')
    return `You are an owner of ${groupName ?? 'a group'} now: its last owner left Tally`;
  if (notice.kind === 'invite_accepted') {
    const who = line.actorPersonId ? context.nameOf(line.actorPersonId) : undefined;
    return `${who ?? 'Someone'} took your invitation and joined${where}`;
  }
  if (notice.kind === 'added_to_group') {
    const who = line.actorPersonId ? context.nameOf(line.actorPersonId) : undefined;
    return `${who ?? 'Someone'} added you to ${groupName ?? 'a group'}`;
  }
  return `${describeActivity(line, context)}${where}`;
}

/** The page a notice opens: the expense or payment it is about, or its group. */
export function noticeHref(notice: Pick<NoticeRow, 'groupId' | 'line'>): string {
  const { line, groupId } = notice;
  const d = line.details as Record<string, unknown>;
  if (line.subjectId) {
    if (line.kind.startsWith('expense_')) return `/g/${groupId}/e/${line.subjectId}`;
    if (line.kind.startsWith('payment_')) return `/g/${groupId}/p/${line.subjectId}`;
    if (line.kind === 'comment_added')
      return `/g/${groupId}/${d.subject === 'payment' ? 'p' : 'e'}/${line.subjectId}`;
  }
  return `/g/${groupId}`;
}

/** How long ago, for the bell: "just now", "5m ago", "3h ago", "2d ago", then the date. Pure, with the time given. Tusk's `src/inbox/ago.ts`. */
export function ago(createdAt: number, now: number, locale?: string): string {
  const seconds = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
    new Date(createdAt),
  );
}

/** The calendar day of a moment in a zone, as `YYYY-MM-DD`. */
function dayIn(at: number, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

/** Notices by the day they were written in the reader's zone, newest first: "Today", "Yesterday", or the date. */
export function groupByDay<T extends { id: string; createdAt: number }>(
  notices: readonly T[],
  now: number,
  zone: string,
  locale?: string,
): { date: string; label: string; notices: T[] }[] {
  const today = dayIn(now, zone);
  const yesterday = dayIn(now - 24 * 60 * 60 * 1000, zone);
  const groups = new Map<string, T[]>();
  for (const notice of [...notices].sort(
    (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1),
  )) {
    const date = dayIn(notice.createdAt, zone);
    groups.set(date, [...(groups.get(date) ?? []), notice]);
  }
  return [...groups].map(([date, list]) => ({
    date,
    label:
      date === today
        ? 'Today'
        : date === yesterday
          ? 'Yesterday'
          : new Intl.DateTimeFormat(locale, {
              timeZone: zone,
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
            }).format(new Date(list[0]?.createdAt ?? now)),
    notices: list,
  }));
}
