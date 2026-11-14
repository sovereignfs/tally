import { type Minor, ZERO, addMinor, negateMinor, subtractMinor, toMinor } from '../money/amount';
import { distribute } from '../money/split';

/**
 * **A balance is derived, never written** (DESIGN.md §10, AGENTS.md). Every figure of who owes whom comes from here: pure functions over a group's rows,
 * run in the browser for the screens (so they work offline), on the server for reminders and guards, and in the tests. One figure, one implementation.
 *
 * Nothing here touches a database or a clock, and nothing blends two currencies: every result is per currency. Deleted rows count for nothing. Ties are
 * broken by the group's member order (`memberOrder` in `src/money/split.ts`), so that every device shows the same figures from the same rows, in any
 * order they arrived.
 */

/** An expense as the balances read it: who paid what, and each member's share, in its currency. The method is never looked at. */
export interface BalanceExpense {
  currency: string;
  deleted?: boolean;
  payers: readonly { memberId: string; amount: Minor }[];
  shares: readonly { memberId: string; amount: Minor }[];
}

/** A payment: `fromId` gave `toId` the amount, outside Tally. */
export interface BalancePayment {
  currency: string;
  deleted?: boolean;
  fromId: string;
  toId: string;
  amount: Minor;
}

export interface GroupRows {
  expenses: readonly BalanceExpense[];
  payments: readonly BalancePayment[];
}

/** One amount owed: `fromId` owes `toId`, in a currency; also a suggested payment, which is the same thing the other way. Always more than zero. */
export interface Debt {
  currency: string;
  fromId: string;
  toId: string;
  amount: Minor;
}

/** Per currency, each member's balance: positive is owed to them, negative is what they owe, zero is settled up. */
export type Balances = ReadonlyMap<string, ReadonlyMap<string, Minor>>;

/** A comparator by the group's member order; anyone not in it (which a caller should not pass) comes after, by id, so the result is still stable. */
export function byMemberOrder(order: readonly string[]) {
  const position = new Map(order.map((id, index) => [id, index]));
  return (a: string, b: string) => {
    const pa = position.get(a) ?? Number.MAX_SAFE_INTEGER;
    const pb = position.get(b) ?? Number.MAX_SAFE_INTEGER;
    return pa - pb || (a < b ? -1 : a > b ? 1 : 0);
  };
}

function bump(table: Map<string, Map<string, Minor>>, currency: string, member: string, by: Minor) {
  let members = table.get(currency);
  if (!members) table.set(currency, (members = new Map()));
  members.set(member, addMinor(members.get(member) ?? ZERO, by));
}

/** Sorts a table's currencies by code and its members by member order, so that iterating it is the same on every device. */
function ordered(table: Map<string, Map<string, Minor>>, order: readonly string[]): Balances {
  const compare = byMemberOrder(order);
  return new Map(
    [...table.keys()]
      .sort()
      .map((currency) => [
        currency,
        new Map(
          [...(table.get(currency) ?? new Map<string, Minor>())].sort(([a], [b]) => compare(a, b)),
        ),
      ]),
  );
}

/**
 * Each member's balance per currency (§10.1): what they paid of expenses, less their shares, plus payments they made, less payments they received.
 * Everyone who took part in a row appears, even at zero. In every currency the balances add up to zero.
 */
export function balances(rows: GroupRows, order: readonly string[]): Balances {
  const table = new Map<string, Map<string, Minor>>();
  for (const expense of rows.expenses) {
    if (expense.deleted) continue;
    for (const payer of expense.payers) bump(table, expense.currency, payer.memberId, payer.amount);
    for (const share of expense.shares)
      bump(table, expense.currency, share.memberId, negateMinor(share.amount));
  }
  for (const payment of rows.payments) {
    if (payment.deleted) continue;
    bump(table, payment.currency, payment.fromId, payment.amount);
    bump(table, payment.currency, payment.toId, negateMinor(payment.amount));
  }
  return ordered(table, order);
}

/** A member's balance in a currency, zero if they have none there. */
export function balanceOf(table: Balances, currency: string, memberId: string): Minor {
  return table.get(currency)?.get(memberId) ?? ZERO;
}

/**
 * Who owes whom, pairwise (§10.2): each member's share of an expense is owed to its payers in proportion to what each paid, divided by the same rounding
 * rule as a split, the shares taken in member order against what each payer has left, so that the pieces add up to the share and to what each paid
 * exactly; what a member owes themselves cancels. A payment reduces the debt between its two
 * members directly. Each pair nets out per currency, and only what is still owed is returned, ordered by currency, then debtor, then creditor in member
 * order. A member's debts here always add up to their balance, and a suggested payment only ever names two people who shared a bill or a payment.
 */
export function pairwiseDebts(rows: GroupRows, order: readonly string[]): Debt[] {
  const compare = byMemberOrder(order);
  // Per currency, per ordered pair (first in member order, second): what the first owes the second, negative when the second owes the first.
  const net = new Map<string, Map<string, { a: string; b: string; owed: Minor }>>();
  const owe = (currency: string, from: string, to: string, amount: Minor) => {
    if (from === to || amount === 0) return;
    const [a, b, signed] =
      compare(from, to) < 0 ? [from, to, amount] : [to, from, negateMinor(amount)];
    let pairs = net.get(currency);
    if (!pairs) net.set(currency, (pairs = new Map()));
    const key = JSON.stringify([a, b]);
    const pair = pairs.get(key) ?? { a, b, owed: ZERO };
    pair.owed = addMinor(pair.owed, signed);
    pairs.set(key, pair);
  };

  for (const expense of rows.expenses) {
    if (expense.deleted) continue;
    // The payers and the shares in member order. Each share is divided among the payers in proportion to what each paid that earlier shares have not
    // yet taken, by the split's rounding rule: so every piece is within a unit of its exact part, the pieces add up to the share, and the pieces paid
    // back to a payer add up to what they paid (the last share takes exactly what is left). Dividing each share alone by what was paid would round
    // the payers' totals apart from what they paid.
    const payers = [...expense.payers].sort((x, y) => compare(x.memberId, y.memberId));
    const shares = [...expense.shares].sort((x, y) => compare(x.memberId, y.memberId));
    let left = payers.map((p) => p.amount);
    for (const share of shares) {
      if (share.amount === 0) continue;
      const parts = distribute(share.amount, left);
      payers.forEach((payer, i) =>
        owe(expense.currency, share.memberId, payer.memberId, parts[i] ?? ZERO),
      );
      left = left.map((amount, i) => subtractMinor(amount, parts[i] ?? ZERO));
    }
  }
  for (const payment of rows.payments) {
    if (payment.deleted) continue;
    // Giving money to someone is owing them less: the receiver now owes the giver, which nets against the other way.
    owe(payment.currency, payment.toId, payment.fromId, payment.amount);
  }

  const debts: Debt[] = [];
  for (const currency of [...net.keys()].sort()) {
    for (const { a, b, owed } of net.get(currency)?.values() ?? []) {
      if (owed > 0) debts.push({ currency, fromId: a, toId: b, amount: owed });
      else if (owed < 0) debts.push({ currency, fromId: b, toId: a, amount: negateMinor(owed) });
    }
  }
  return sortDebts(debts, order);
}

function sortDebts(debts: Debt[], order: readonly string[]): Debt[] {
  const compare = byMemberOrder(order);
  return debts.sort(
    (x, y) =>
      (x.currency < y.currency ? -1 : x.currency > y.currency ? 1 : 0) ||
      compare(x.fromId, y.fromId) ||
      compare(x.toId, y.toId),
  );
}

/**
 * The fewest payments that settle everyone, from the balances alone (§10.3): in each currency the largest debtor pays the largest creditor as much as
 * one of them is out, and so on, ties broken by member order, until everyone is at zero. Greedy minimum cash flow; it can name two people who never
 * shared a bill, which is what the setting says it does.
 */
export function simplifiedPayments(table: Balances, order: readonly string[]): Debt[] {
  const compare = byMemberOrder(order);
  const payments: Debt[] = [];
  for (const [currency, members] of table) {
    const left = new Map([...members].filter(([, amount]) => amount !== 0));
    // The largest amount first, and among equals the first in member order.
    const largest = (sign: 1 | -1) => {
      let best: string | null = null;
      for (const [id, amount] of left) {
        if (Math.sign(amount) !== sign) continue;
        const current = best === null ? ZERO : (left.get(best) ?? ZERO);
        const more = sign * amount - sign * current;
        if (best === null || more > 0 || (more === 0 && compare(id, best) < 0)) best = id;
      }
      return best;
    };
    for (;;) {
      const debtor = largest(-1);
      const creditor = largest(1);
      if (debtor === null || creditor === null) break;
      const owes = negateMinor(left.get(debtor) ?? ZERO);
      const owed = left.get(creditor) ?? ZERO;
      const amount = owes < owed ? owes : owed;
      payments.push({ currency, fromId: debtor, toId: creditor, amount });
      const debtorLeft = addMinor(left.get(debtor) ?? ZERO, amount);
      const creditorLeft = subtractMinor(owed, amount);
      if (debtorLeft === 0) left.delete(debtor);
      else left.set(debtor, debtorLeft);
      if (creditorLeft === 0) left.delete(creditor);
      else left.set(creditor, creditorLeft);
    }
  }
  return payments;
}

/** The suggested payments of a group (Settle up, reminders), by its setting: pairwise with simplify debts off, the default; simplified with it on. */
export function suggestedPayments(
  rows: GroupRows,
  order: readonly string[],
  simplify: boolean,
): Debt[] {
  return simplify ? simplifiedPayments(balances(rows, order), order) : pairwiseDebts(rows, order);
}

/** The payments a set of debts would record: the same figures, as rows the balances read, so that applying the suggestions can be checked. */
export function asPayments(debts: readonly Debt[]): BalancePayment[] {
  return debts.map((d) => ({
    currency: d.currency,
    fromId: d.fromId,
    toId: d.toId,
    amount: toMinor(d.amount),
  }));
}
