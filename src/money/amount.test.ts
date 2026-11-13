import { describe, expect, it } from 'vitest';
import {
  type Minor,
  MoneyError,
  addMinor,
  assertMinor,
  isMinor,
  negateMinor,
  subtractMinor,
  sumMinor,
  toMinor,
} from './amount';

const m = (value: number) => toMinor(value);

describe('what an amount is', () => {
  it('is a whole number a JavaScript number holds exactly', () => {
    for (const ok of [0, 1, -1, 340, -90_000_000_000_000, Number.MAX_SAFE_INTEGER])
      expect(isMinor(ok), String(ok)).toBe(true);
  });

  it('is never a float, a NaN, an infinity, a number too large to be exact, a string or a bigint', () => {
    for (const bad of [
      12.5,
      0.1 + 0.2,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      2 ** 60,
      '340',
      340n,
      null,
      undefined,
      {},
    ])
      expect(isMinor(bad), String(bad)).toBe(false);
  });

  it('is refused by `assertMinor` with a sentence that names what was wrong and never the value', () => {
    expect(() => assertMinor(12.5)).toThrow(MoneyError);
    expect(() => assertMinor(12.5, 'the price')).toThrow(/the price must be a whole number/);
    expect(() => assertMinor(12.5)).not.toThrow(/12\.5/);
    expect(() => assertMinor(340)).not.toThrow();
  });
});

describe('adding', () => {
  it('is exact, where a float is not', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(addMinor(m(10), m(20))).toBe(30);
    expect(sumMinor([m(1_000_000_000_001), m(-1), m(2)])).toBe(1_000_000_000_002);
    expect(sumMinor([])).toBe(0);
  });

  it('refuses a total too large to be exact, and an amount that is not one, and never rounds', () => {
    expect(() => addMinor(m(Number.MAX_SAFE_INTEGER), m(1))).toThrow(MoneyError);
    // A float can only get here by being forced past the type, and is refused at run time too.
    expect(() => addMinor(m(1), 0.5 as Minor)).toThrow(MoneyError);
    expect(() => sumMinor([m(1), m(2), Number.NaN as Minor])).toThrow(MoneyError);
  });
});

describe('subtracting and negating', () => {
  it('is exact, and never gives a negative zero', () => {
    expect(subtractMinor(m(1000), m(1001))).toBe(-1);
    expect(Object.is(negateMinor(m(0)), -0)).toBe(false);
    expect(negateMinor(m(250))).toBe(-250);
  });

  it('turns a number into an amount only when it is one', () => {
    expect(toMinor(340)).toBe(340);
    expect(() => toMinor(3.4, 'the amount')).toThrow(/the amount must be a whole number/);
  });
});
