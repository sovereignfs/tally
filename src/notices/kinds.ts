import type { ActivityKind } from '../activity/kinds';

/**
 * **The kinds of notice** (DESIGN.md §12.2), and which line of activity each is told of. Pure: shared by the server, which raises them, and the device,
 * which says them in words through the activity line they point at.
 *
 *  - **The group's kinds** go to every member with an account, by their choice for the group (`member.notify`): `all`, `involved` (worked out from the
 *    line's payers, shares, payment and comments), or `none`.
 *  - **The personal kinds** go to one person whatever their choice.
 */
export const NOTICE_KINDS = [
  'added_to_group',
  'expense_added',
  'expense_changed',
  'payment_recorded',
  'comment',
  'group_closed',
  'reminder',
  'invite_accepted',
  'edit_replaced',
  'owner_passed',
] as const;

export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const PERSONAL_KINDS: ReadonlySet<NoticeKind> = new Set([
  'added_to_group',
  'reminder',
  'invite_accepted',
  'edit_replaced',
  'owner_passed',
]);

export function isNoticeKind(value: unknown): value is NoticeKind {
  return typeof value === 'string' && (NOTICE_KINDS as readonly string[]).includes(value);
}

/** The group's kind a line of activity is told as, if any. */
export const GROUP_KIND_OF: Partial<Record<ActivityKind, NoticeKind>> = {
  expense_added: 'expense_added',
  expense_edited: 'expense_changed',
  expense_deleted: 'expense_changed',
  expense_restored: 'expense_changed',
  expense_replaced: 'expense_changed',
  payment_added: 'payment_recorded',
  payment_edited: 'payment_recorded',
  payment_deleted: 'payment_recorded',
  payment_restored: 'payment_recorded',
  payment_replaced: 'payment_recorded',
  comment_added: 'comment',
  group_closed: 'group_closed',
  group_reopened: 'group_closed',
};

/** A notice as the bell reads it: the line it tells of, whether it is read. */
export interface NoticeRow {
  id: string;
  kind: NoticeKind;
  groupId: string;
  read: boolean;
  createdAt: number;
  /** The activity line, as `GET /api/activity` gives it. */
  line: {
    id: string;
    groupId: string;
    kind: ActivityKind;
    actorPersonId: string | null;
    subjectId: string | null;
    details: unknown;
    createdAt: number;
  };
}
