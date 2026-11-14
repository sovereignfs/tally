/**
 * **What happened in a group** (DESIGN.md §12.1): every kind an `activity` line can be, and what its details carry. Written by the change that causes
 * it, in its transaction (`src/sync/apply.ts`, `src/groups/ops.ts`), and said in words on the device (`describe.ts`). What people wrote travels in the
 * details only as the change carried it, sealed (§5.3), so that the device opens it and the server never reads it.
 *
 * Pure: imports nothing, shared by the server, the device and the tests.
 */
export const ACTIVITY_KINDS = [
  'expense_added',
  'expense_edited',
  'expense_deleted',
  'expense_restored',
  'expense_replaced',
  'payment_added',
  'payment_edited',
  'payment_deleted',
  'payment_restored',
  'payment_replaced',
  'comment_added',
  'group_created',
  'group_renamed',
  'group_currency_changed',
  'group_simplify_changed',
  'group_closed',
  'group_reopened',
  'member_added',
  'member_invited',
  'member_joined',
  'member_left',
  'member_removed',
  'member_merged',
  'role_changed',
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export function isActivityKind(value: unknown): value is ActivityKind {
  return typeof value === 'string' && (ACTIVITY_KINDS as readonly string[]).includes(value);
}

/** An expense's line: its figures, who paid and who shared, its sealed `{description, note}`, and for a replaced one, whose version it replaced. */
export interface ExpenseDetails {
  sealed: string;
  amount: number;
  currency: string;
  payers: { memberId: string; amount: number }[];
  shares: { memberId: string; amount: number }[];
  /** For `expense_replaced`: the person whose version this change overwrote. */
  replacedPersonId?: string;
}

export interface PaymentDetails {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  currency: string;
  replacedPersonId?: string;
}

export interface CommentDetails {
  subject: 'expense' | 'payment';
  /** The comment's sealed `{body}`. */
  sealed: string;
  /** What it is on, sealed as it was: an expense's `{description, note}`; null for a payment. */
  subjectSealed: string | null;
}

export interface GroupNameDetails {
  /** The group's sealed `{name}`, as it now is. */
  sealed: string;
}

export interface CurrencyDetails {
  from: string;
  to: string;
}

export interface SimplifyDetails {
  on: boolean;
}

/** Someone's place: the member and their person (for the name, which outlives the membership). */
export interface MemberDetails {
  memberId: string;
  personId: string;
  /** For `member_merged`: the placeholder whose history the member took over. */
  fromPersonId?: string;
}

export interface RoleDetails {
  memberId: string;
  personId: string;
  role: 'owner' | 'member';
}

export interface ActivityDetailsOf {
  expense_added: ExpenseDetails;
  expense_edited: ExpenseDetails;
  expense_deleted: ExpenseDetails;
  expense_restored: ExpenseDetails;
  expense_replaced: ExpenseDetails;
  payment_added: PaymentDetails;
  payment_edited: PaymentDetails;
  payment_deleted: PaymentDetails;
  payment_restored: PaymentDetails;
  payment_replaced: PaymentDetails;
  comment_added: CommentDetails;
  group_created: GroupNameDetails;
  group_renamed: GroupNameDetails;
  group_currency_changed: CurrencyDetails;
  group_simplify_changed: SimplifyDetails;
  group_closed: Record<string, never>;
  group_reopened: Record<string, never>;
  member_added: MemberDetails;
  member_invited: MemberDetails;
  member_joined: MemberDetails;
  member_left: MemberDetails;
  member_removed: MemberDetails;
  member_merged: MemberDetails;
  role_changed: RoleDetails;
}

/** One line, as it is read back. */
export type ActivityLine = {
  [K in ActivityKind]: {
    id: string;
    groupId: string;
    kind: K;
    actorPersonId: string | null;
    subjectId: string | null;
    details: ActivityDetailsOf[K];
    createdAt: number;
  };
}[ActivityKind];
