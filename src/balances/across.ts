import { type Minor, ZERO, addMinor, negateMinor } from '../money/amount';
import {
  type Balances,
  type GroupRows,
  balances,
  pairwiseDebts,
  simplifiedPayments,
} from './index';

/**
 * **Across groups** (DESIGN.md §10.4): what lies between the reader and one other person in every group they share, and the reader's whole position.
 * Pure, over each group's rows, run on the device for Home and a person's page. **Never a figure in two currencies, and nothing moves between groups:**
 * a payment is always in one group, so settling up with a person is one payment per group and currency (§9).
 */
export interface SharedGroup {
  groupId: string;
  rows: GroupRows;
  order: readonly string[];
  simplify: boolean;
  /** The reader's member in this group. */
  me: string;
  /** The other person's member in this group, if they are in it. */
  them?: string;
}

/** In one group and currency, what the other person owes the reader: positive, they owe the reader; negative, the reader owes them. */
export interface Between {
  groupId: string;
  currency: string;
  amount: Minor;
}

/**
 * What lies between the reader and one other person (§10.4), per group and currency, only where it is not zero: the pairwise debt between the two, or,
 * with simplify debts on in that group, the suggested payments between them.
 */
export function betweenTwo(groups: readonly SharedGroup[]): Between[] {
  const out: Between[] = [];
  for (const group of groups) {
    if (!group.them) continue;
    const debts = group.simplify
      ? simplifiedPayments(balances(group.rows, group.order), group.order)
      : pairwiseDebts(group.rows, group.order);
    const byCurrency = new Map<string, Minor>();
    for (const debt of debts) {
      const owes = debt.fromId === group.them && debt.toId === group.me;
      const owed = debt.fromId === group.me && debt.toId === group.them;
      if (!owes && !owed) continue;
      byCurrency.set(
        debt.currency,
        addMinor(
          byCurrency.get(debt.currency) ?? ZERO,
          owes ? debt.amount : negateMinor(debt.amount),
        ),
      );
    }
    for (const [currency, amount] of [...byCurrency].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ))
      if (amount !== 0) out.push({ groupId: group.groupId, currency, amount });
  }
  return out;
}

/** The sum per currency of what lies between two people, for the line that says it at the top of a person's page and on Home. */
export function totalBetween(between: readonly Between[]): Map<string, Minor> {
  const totals = new Map<string, Minor>();
  for (const b of between)
    totals.set(b.currency, addMinor(totals.get(b.currency) ?? ZERO, b.amount));
  return totals;
}

/** The reader's position in one currency: what is owed to them and what they owe, summed over groups separately, since one cannot pay off the other. */
export interface Position {
  currency: string;
  owed: Minor;
  owing: Minor;
}

/** The reader's whole position (§15.4): per currency, owed and owing, the primary currency first and then the largest. */
export function position(
  groups: readonly { balances: Balances; me: string }[],
  primaryCurrency: string,
): Position[] {
  const byCurrency = new Map<string, Position>();
  for (const group of groups)
    for (const [currency, members] of group.balances) {
      const amount = members.get(group.me) ?? ZERO;
      if (amount === 0) continue;
      const entry = byCurrency.get(currency) ?? { currency, owed: ZERO, owing: ZERO };
      if (amount > 0) entry.owed = addMinor(entry.owed, amount);
      else entry.owing = addMinor(entry.owing, negateMinor(amount));
      byCurrency.set(currency, entry);
    }
  return [...byCurrency.values()].sort(
    (a, b) =>
      Number(b.currency === primaryCurrency) - Number(a.currency === primaryCurrency) ||
      b.owed + b.owing - (a.owed + a.owing) ||
      (a.currency < b.currency ? -1 : 1),
  );
}

/** One payment that "settle up with a person" records: in a group, between the two members, the whole of what lies between them in a currency. */
export interface SettlePayment {
  groupId: string;
  currency: string;
  fromMemberId: string;
  toMemberId: string;
  amount: Minor;
}

/** The payments that settle everything between the reader and one person (§9): one per group and currency, each zeroing that pair, exactly as settling each group in turn. */
export function settleWithPerson(groups: readonly SharedGroup[]): SettlePayment[] {
  const out: SettlePayment[] = [];
  for (const b of betweenTwo(groups)) {
    const group = groups.find((g) => g.groupId === b.groupId);
    if (!group?.them) continue;
    out.push(
      b.amount > 0
        ? {
            groupId: b.groupId,
            currency: b.currency,
            fromMemberId: group.them,
            toMemberId: group.me,
            amount: b.amount,
          }
        : {
            groupId: b.groupId,
            currency: b.currency,
            fromMemberId: group.me,
            toMemberId: group.them,
            amount: negateMinor(b.amount),
          },
    );
  }
  return out;
}
