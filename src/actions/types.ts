import type { Minor } from '../money/amount';
import type { SplitMethod } from '../money/split';
import type { Category } from './categories';

/**
 * **A mutation** (DESIGN.md §11.2): what a recorded action becomes, one or more row changes with an id the device made, so that sending it twice is
 * harmless. Only expenses, payments and comments travel this way (and offline); everything else is an online operation (`/api/ops`).
 *
 * An expense or a payment travels whole, with the version the device edited (`baseVersion`, `null` for a new one); a comment is only ever made or
 * deleted. What people wrote is in `sealed`, opened only on a member's device (§5.3).
 */

/** An expense as it travels and is stored, without what the server adds (`version`, who, when). */
export interface ExpenseRow {
  /** `{description, note}`, sealed under the group's key. */
  sealed: string;
  amount: Minor;
  currency: string;
  /** `YYYY-MM-DD`, no time zone. */
  date: string;
  category: Category;
  method: SplitMethod;
  payers: { memberId: string; amount: Minor }[];
  shares: { memberId: string; amount: Minor; units: number | null }[];
}

export interface PaymentRow {
  /** `{note}`, sealed; `null` with no note. */
  sealed: string | null;
  fromMemberId: string;
  toMemberId: string;
  amount: Minor;
  currency: string;
  date: string;
}

export const COMMENT_SUBJECTS = ['expense', 'payment'] as const;
export type CommentSubject = (typeof COMMENT_SUBJECTS)[number];

export interface CommentRow {
  subject: CommentSubject;
  subjectId: string;
  /** `{body}`, sealed. */
  sealed: string;
}

export type ExpenseChange =
  | { table: 'expense'; op: 'put'; id: string; baseVersion: number | null; row: ExpenseRow }
  | { table: 'expense'; op: 'delete' | 'restore'; id: string; baseVersion: number };

export type PaymentChange =
  | { table: 'payment'; op: 'put'; id: string; baseVersion: number | null; row: PaymentRow }
  | { table: 'payment'; op: 'delete' | 'restore'; id: string; baseVersion: number };

export type CommentChange =
  | { table: 'comment'; op: 'put'; id: string; row: CommentRow }
  | { table: 'comment'; op: 'delete'; id: string };

export type Change = ExpenseChange | PaymentChange | CommentChange;

export interface Mutation {
  mutationId: string;
  groupId: string;
  changes: Change[];
}
