import { type Minor } from '../money/amount';
import {
  type SplitInput,
  type SplitMethod,
  SplitError,
  checkPayers,
  computeShares,
} from '../money/split';
import type { Category } from './categories';
import type { Checked } from './validate';
import type { CommentSubject, ExpenseRow, Mutation, PaymentRow } from './types';

/**
 * **Every recorded action is a pure function** (DESIGN.md §11.2): from intent and the current rows to a mutation, with the ids the caller made (a new
 * expense exists on the device at once, and a comment can point at it offline). Nothing here seals, stores or sends: the device seals what was typed
 * (after `checkExpenseText` and its siblings), calls an action, and puts the mutation in its outbox in the same transaction as the rows. The server
 * applies it through `src/sync/apply.ts`, which checks it again.
 */

export * from './types';
export * from './categories';

/** What the add sheet says of an expense, before the shares are worked out. */
export interface ExpenseIntent {
  sealed: string;
  amount: Minor;
  currency: string;
  date: string;
  category: Category;
  method: SplitMethod;
  payers: readonly { memberId: string; amount: Minor }[];
  split: readonly SplitInput[];
}

/**
 * An expense row from the add sheet: the payers and the shares by the one rounding rule (`split.ts`), in the group's member order. A split that cannot
 * be made is a refusal (`payers`, `shares`), with nothing thrown.
 */
export function expenseRow(intent: ExpenseIntent, order: readonly string[]): Checked<ExpenseRow> {
  try {
    const payers = checkPayers(intent.amount, intent.payers, order);
    try {
      const shares = computeShares(intent.amount, intent.method, intent.split, order);
      return {
        ok: true,
        value: {
          sealed: intent.sealed,
          amount: intent.amount,
          currency: intent.currency,
          date: intent.date,
          category: intent.category,
          method: intent.method,
          payers,
          shares,
        },
      };
    } catch (error) {
      if (error instanceof SplitError)
        return { ok: false, refusal: { code: error.code === 'AMOUNT' ? 'amount' : 'shares' } };
      throw error;
    }
  } catch (error) {
    if (error instanceof SplitError)
      return { ok: false, refusal: { code: error.code === 'AMOUNT' ? 'amount' : 'payers' } };
    throw error;
  }
}

interface Ids {
  mutationId: string;
  groupId: string;
}

/** The version a device holds of a row: what an edit, a delete or a restore is based on. */
interface Current {
  id: string;
  version: number;
}

const one = (ids: Ids, change: Mutation['changes'][number]): Mutation => ({
  mutationId: ids.mutationId,
  groupId: ids.groupId,
  changes: [change],
});

export function addExpense(ids: Ids & { expenseId: string; row: ExpenseRow }): Mutation {
  return one(ids, {
    table: 'expense',
    op: 'put',
    id: ids.expenseId,
    baseVersion: null,
    row: ids.row,
  });
}

/** An edit replaces the whole expense (§8.5): its fields, payers and split together, based on the version the device held. */
export function editExpense(ids: Ids & { current: Current; row: ExpenseRow }): Mutation {
  return one(ids, {
    table: 'expense',
    op: 'put',
    id: ids.current.id,
    baseVersion: ids.current.version,
    row: ids.row,
  });
}

export function deleteExpense(ids: Ids & { current: Current }): Mutation {
  return one(ids, {
    table: 'expense',
    op: 'delete',
    id: ids.current.id,
    baseVersion: ids.current.version,
  });
}

export function restoreExpense(ids: Ids & { current: Current }): Mutation {
  return one(ids, {
    table: 'expense',
    op: 'restore',
    id: ids.current.id,
    baseVersion: ids.current.version,
  });
}

export function addPayment(ids: Ids & { paymentId: string; row: PaymentRow }): Mutation {
  return one(ids, {
    table: 'payment',
    op: 'put',
    id: ids.paymentId,
    baseVersion: null,
    row: ids.row,
  });
}

export function editPayment(ids: Ids & { current: Current; row: PaymentRow }): Mutation {
  return one(ids, {
    table: 'payment',
    op: 'put',
    id: ids.current.id,
    baseVersion: ids.current.version,
    row: ids.row,
  });
}

export function deletePayment(ids: Ids & { current: Current }): Mutation {
  return one(ids, {
    table: 'payment',
    op: 'delete',
    id: ids.current.id,
    baseVersion: ids.current.version,
  });
}

export function restorePayment(ids: Ids & { current: Current }): Mutation {
  return one(ids, {
    table: 'payment',
    op: 'restore',
    id: ids.current.id,
    baseVersion: ids.current.version,
  });
}

/**
 * Settle up with a person (§9): one payment for every group and currency in which the two have a balance, each its own mutation in its own group, as if
 * each group had been settled in turn. There is no payment across groups in the data.
 */
export function settleUp(
  payments: readonly (Ids & { paymentId: string; row: PaymentRow })[],
): Mutation[] {
  return payments.map(addPayment);
}

export function addComment(
  ids: Ids & { commentId: string; subject: CommentSubject; subjectId: string; sealed: string },
): Mutation {
  return one(ids, {
    table: 'comment',
    op: 'put',
    id: ids.commentId,
    row: { subject: ids.subject, subjectId: ids.subjectId, sealed: ids.sealed },
  });
}

export function deleteComment(ids: Ids & { commentId: string }): Mutation {
  return one(ids, { table: 'comment', op: 'delete', id: ids.commentId });
}
