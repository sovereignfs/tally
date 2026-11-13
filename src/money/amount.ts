/**
 * **Money is a whole number of a currency's smallest unit, always** (DESIGN.md §8.7, AGENTS.md). No floating point touches an amount: it is a safe
 * integer, sums are exact, and a split (`split.ts`, task 4.2) divides integers.
 *
 * `Minor` is a branded number: a plain `number`, and so a float, cannot be passed where an amount is wanted without going through `toMinor`, which
 * checks it, or a function here that makes one from amounts. That is how "a float never reaches an amount" is held by the compiler and not by care
 * (`amount.types.test.ts`). A column of money is written from a `Minor` alone.
 */
declare const minorBrand: unique symbol;
export type Minor = number & { readonly [minorBrand]: true };

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * Whether a value is an amount that may be stored: a whole number a JavaScript number holds exactly (±9 007 199 254 740 991 minor units, more than
 * anyone holds in any currency). A float (12.5), a NaN, an infinity, a number too large to be exact, a string and a bigint are not.
 */
export function isMinor(value: unknown): value is Minor {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Throws a `MoneyError` for anything that is not an amount, with a sentence that names what and never the value. */
export function assertMinor(value: unknown, what = 'an amount'): asserts value is Minor {
  if (!isMinor(value))
    throw new MoneyError(`${what} must be a whole number of the currency’s smallest unit`);
}

/** A checked amount: the one way from a `number` (a row read back, a value parsed) to a `Minor`. */
export function toMinor(value: unknown, what?: string): Minor {
  assertMinor(value, what);
  return value;
}

export const ZERO = 0 as Minor;

/** The sum of two amounts, which must also be an amount: a total too large to be exact is refused and not rounded. */
export function addMinor(a: Minor, b: Minor): Minor {
  return toMinor(toMinor(a) + toMinor(b), 'a total');
}

export function subtractMinor(a: Minor, b: Minor): Minor {
  return toMinor(toMinor(a) - toMinor(b), 'a difference');
}

export function negateMinor(a: Minor): Minor {
  return toMinor(-toMinor(a) || 0);
}

/** The sum of amounts, exactly, or a `MoneyError`. */
export function sumMinor(amounts: readonly Minor[]): Minor {
  let total = ZERO;
  for (const amount of amounts) total = addMinor(total, amount);
  return total;
}
