import { type Minor, MoneyError, ZERO, isMinor, sumMinor, toMinor } from './amount';

/**
 * **A split has one rounding rule, and this is it** (DESIGN.md §8.3, AGENTS.md): used by the browser, the server, the seed and import.
 *
 * Every method comes down to weights: each member's share is the amount × their weight ÷ the total weight, **rounded down**, and the minor units left
 * over (fewer than there are members) go **one each to the members in the group's member order** (when they joined, then id). The order is the group's
 * and never the form's, so the same split gives the same shares on every device, on every run, and an expense edited twice never moves a cent.
 *
 * What is stored is the share, for every method; `units`, the input, is kept beside it only so that editing shows what was typed. The server recomputes
 * the shares from the method and units (`checkShares`) and refuses a mutation whose shares differ.
 *
 * Integer arithmetic only, in `bigint` where amount × weight could pass what a number holds exactly; no floating point touches an amount.
 */

export const SPLIT_METHODS = ['equal', 'amounts', 'percentages', 'shares'] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

export function isSplitMethod(value: unknown): value is SplitMethod {
  return typeof value === 'string' && (SPLIT_METHODS as readonly string[]).includes(value);
}

/** 100.00%, in basis points. */
export const WHOLE_PERCENT = 10_000;
/** The largest weight for Shares (×100, so 1,000 shares), so that a typo of a thousand thousand is refused and not stored. */
export const MAX_SHARE_WEIGHT = 100_000;

/**
 * What the form says for one member. `units` is, by method: **equal**, `null` (listed means included); **amounts**, their amount in minor units;
 * **percentages**, basis points (`2500` = 25.00%); **shares**, a weight ×100 (`150` = 1.5 shares).
 */
export interface SplitInput {
  memberId: string;
  units: number | null;
}

/** One member's share, as it is stored. */
export interface Share {
  memberId: string;
  amount: Minor;
  units: number | null;
}

export interface Payer {
  memberId: string;
  amount: Minor;
}

export type SplitErrorCode =
  | 'AMOUNT'
  | 'EMPTY'
  | 'DUPLICATE'
  | 'NOT_A_MEMBER'
  | 'UNITS'
  | 'PERCENT_TOTAL'
  | 'AMOUNTS_TOTAL'
  | 'PAYERS_TOTAL'
  | 'MISMATCH';

/** A split that cannot be made, with a code a validator maps to a sentence; it never carries an amount or a name. */
export class SplitError extends MoneyError {
  constructor(
    readonly code: SplitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SplitError';
  }
}

/**
 * Divides `total` by `weights` with the one rounding rule. `weights` is in the order the leftover goes in (the group's member order); every weight is a
 * non-negative whole number and at least one is positive. The parts add up to `total` exactly. A negative total divides as its opposite, negated, so
 * that the rule is the same either side of zero.
 */
export function distribute(total: Minor, weights: readonly number[]): Minor[] {
  toMinor(total, 'the total');
  if (weights.length === 0) throw new SplitError('EMPTY', 'there is no one to divide among');
  if (total < 0) return distribute(toMinor(-total), weights).map((part) => toMinor(-part || 0));
  let weightSum = 0n;
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0)
      throw new SplitError('UNITS', 'a weight must be a whole number, zero or more');
    weightSum += BigInt(weight);
  }
  if (weightSum === 0n) throw new SplitError('UNITS', 'the weights add up to nothing');
  const big = BigInt(total);
  const exact = weights.map((weight) => (big * BigInt(weight)) / weightSum);
  let left = big - exact.reduce((a, b) => a + b, 0n);
  // Fewer units are left than there are positive weights (each part lost less than one), so one pass gives them out: one each, in order, to those with
  // a weight; a member on no share gets none of the rest.
  return exact.map((part, i) => {
    if (left > 0n && (weights[i] ?? 0) > 0) {
      left -= 1n;
      return toMinor(Number(part + 1n));
    }
    return toMinor(Number(part));
  });
}

/** `distribute`, over members: each with their part of `total` by `weight`, in the order given. */
function divideAmong<T>(total: Minor, items: readonly T[], weight: (item: T) => number) {
  const parts = distribute(total, items.map(weight));
  return items.map((item, i) => ({ item, part: parts[i] ?? ZERO }));
}

/**
 * Puts the members in the group's order, and refuses a member twice or one who is not in it. `order` is the group's member ids, by when they joined
 * and then id (`memberOrder`).
 */
function inOrder<T extends { memberId: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  const position = new Map(order.map((id, index) => [id, index]));
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.memberId)) throw new SplitError('DUPLICATE', 'a member is listed twice');
    seen.add(item.memberId);
    if (!position.has(item.memberId))
      throw new SplitError('NOT_A_MEMBER', 'someone listed is not in the group');
  }
  const at = (item: T) => position.get(item.memberId) ?? 0;
  return [...items].sort((a, b) => at(a) - at(b));
}

/** The group's member order, the one the leftover follows: by when each joined, then by id. */
export function memberOrder(
  members: readonly { id: string; joinedAt: string | number | Date }[],
): string[] {
  const time = (at: string | number | Date) => new Date(at).getTime();
  return [...members]
    .sort((a, b) => time(a.joinedAt) - time(b.joinedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((member) => member.id);
}

/** Percentages and shares: each member's part by their units, which the caller has checked are positive. */
function weighted(amount: Minor, members: readonly SplitInput[]): Share[] {
  return divideAmong(amount, members, (m) => m.units ?? 0).map(({ item, part }) => ({
    memberId: item.memberId,
    amount: part,
    units: item.units,
  }));
}

function positive(value: number | null, max: number): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0 && value <= max;
}

/**
 * The shares of an expense of `amount`, split by `method` among `inputs`, in the group's member order. Refuses an amount that is not positive, nobody,
 * a member twice or not in the group, units that are not the method's, percentages not totalling 100.00%, and amounts not adding up to the expense.
 * The result does not depend on the order of `inputs`.
 */
export function computeShares(
  amount: Minor,
  method: SplitMethod,
  inputs: readonly SplitInput[],
  order: readonly string[],
): Share[] {
  if (!isMinor(amount) || amount <= 0)
    throw new SplitError('AMOUNT', 'an expense’s amount must be more than zero');
  if (inputs.length === 0) throw new SplitError('EMPTY', 'an expense must be for someone');
  const members = inOrder(inputs, order);

  switch (method) {
    case 'equal': {
      if (members.some((m) => m.units !== null))
        throw new SplitError('UNITS', 'an equal split takes no input per member');
      return divideAmong(amount, members, () => 1).map(({ item, part }) => ({
        memberId: item.memberId,
        amount: part,
        units: null,
      }));
    }
    case 'amounts': {
      if (!members.every((m) => positive(m.units, Number.MAX_SAFE_INTEGER)))
        throw new SplitError('UNITS', 'each amount must be more than zero');
      const shares = members.map((m) => ({
        memberId: m.memberId,
        amount: toMinor(m.units),
        units: m.units,
      }));
      if (sumMinor(shares.map((s) => s.amount)) !== amount)
        throw new SplitError('AMOUNTS_TOTAL', 'the amounts must add up to the expense');
      return shares;
    }
    case 'percentages': {
      if (!members.every((m) => positive(m.units, WHOLE_PERCENT)))
        throw new SplitError('UNITS', 'each percentage must be more than 0% and at most 100%');
      if (members.reduce((sum, m) => sum + (m.units ?? 0), 0) !== WHOLE_PERCENT)
        throw new SplitError('PERCENT_TOTAL', 'the percentages must add up to 100%');
      return weighted(amount, members);
    }
    case 'shares': {
      if (!members.every((m) => positive(m.units, MAX_SHARE_WEIGHT)))
        throw new SplitError('UNITS', 'each share must be more than zero');
      return weighted(amount, members);
    }
  }
}

/**
 * The server's check (§11.5): whether `shares` are exactly what `method` and their own `units` give, in any order. Throws a `SplitError`, `MISMATCH`
 * when the shares differ from the recomputed ones, so that a device with another rounding, or a hand-made request, is refused and not stored.
 */
export function checkShares(
  amount: Minor,
  method: SplitMethod,
  shares: readonly Share[],
  order: readonly string[],
): Share[] {
  const expected = computeShares(
    amount,
    method,
    shares.map((s) => ({ memberId: s.memberId, units: s.units })),
    order,
  );
  const given = new Map(shares.map((s) => [s.memberId, s.amount]));
  for (const share of expected)
    if (given.get(share.memberId) !== share.amount)
      throw new SplitError('MISMATCH', 'the shares do not match the split');
  return expected;
}

/**
 * The payers of an expense of `amount` (§8.2), in the group's member order: each paid more than zero, nobody twice, everyone in the group, and together
 * exactly the amount.
 */
export function checkPayers(
  amount: Minor,
  payers: readonly Payer[],
  order: readonly string[],
): Payer[] {
  if (!isMinor(amount) || amount <= 0)
    throw new SplitError('AMOUNT', 'an expense’s amount must be more than zero');
  if (payers.length === 0) throw new SplitError('EMPTY', 'someone must have paid');
  const sorted = inOrder(payers, order);
  if (!sorted.every((p) => isMinor(p.amount) && p.amount > 0))
    throw new SplitError('UNITS', 'what each paid must be more than zero');
  if (sumMinor(sorted.map((p) => p.amount)) !== amount)
    throw new SplitError('PAYERS_TOTAL', 'what was paid must add up to the expense');
  return sorted.map((p) => ({ memberId: p.memberId, amount: p.amount }));
}
