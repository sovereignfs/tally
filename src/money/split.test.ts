import { describe, expect, it } from 'vitest';
import { type Random, forSeeds } from '../testing/random';
import { type Minor, toMinor } from './amount';
import { parseAmount } from './text';
import {
  type SplitErrorCode,
  type SplitInput,
  type SplitMethod,
  SplitError,
  checkPayers,
  checkShares,
  computeShares,
  distribute,
  memberOrder,
} from './split';

const m = (value: number) => toMinor(value);
const ORDER = ['ana', 'ben', 'cy', 'dee'];

function refused(code: SplitErrorCode, run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SplitError);
    expect((error as SplitError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, and it was accepted`);
}

const amounts = (shares: { amount: Minor }[]) => shares.map((s) => s.amount);

describe('equally', () => {
  it('gives 100.00 three ways as 33.34, 33.33, 33.33, the extra cent to the first in member order, on every run', () => {
    const inputs: SplitInput[] = ['cy', 'ana', 'ben'].map((memberId) => ({
      memberId,
      units: null,
    }));
    for (let run = 0; run < 5; run++) {
      const shares = computeShares(m(10_000), 'equal', inputs, ORDER);
      expect(shares.map((s) => [s.memberId, s.amount])).toEqual([
        ['ana', 3334],
        ['ben', 3333],
        ['cy', 3333],
      ]);
    }
  });

  it('follows the group’s order, not the form’s: the first to join gets the leftover', () => {
    const order = memberOrder([
      { id: 'zed', joinedAt: '2026-01-01T00:00:00Z' },
      { id: 'amy', joinedAt: '2026-02-01T00:00:00Z' },
      { id: 'bo', joinedAt: '2026-02-01T00:00:00Z' },
    ]);
    expect(order).toEqual(['zed', 'amy', 'bo']);
    const shares = computeShares(
      m(200),
      'equal',
      [
        { memberId: 'bo', units: null },
        { memberId: 'amy', units: null },
        { memberId: 'zed', units: null },
      ],
      order,
    );
    expect(amounts(shares)).toEqual([67, 67, 66]);
  });

  it('works in each currency’s own minor unit: JPY has none, BHD three', () => {
    const three = ORDER.slice(0, 3).map((memberId) => ({ memberId, units: null }));
    // ¥1,000 three ways: 334, 333, 333 yen.
    expect(
      amounts(computeShares(parseAmount('1000', 'JPY') as Minor, 'equal', three, ORDER)),
    ).toEqual([334, 333, 333]);
    // BHD 1.000 three ways: 0.334, 0.333, 0.333.
    expect(amounts(computeShares(parseAmount('1', 'BHD') as Minor, 'equal', three, ORDER))).toEqual(
      [334, 333, 333],
    );
    // EUR 10.00 four ways is even.
    expect(
      amounts(
        computeShares(
          parseAmount('10', 'EUR') as Minor,
          'equal',
          ORDER.map((memberId) => ({ memberId, units: null })),
          ORDER,
        ),
      ),
    ).toEqual([250, 250, 250, 250]);
  });

  it('takes no input per member', () => {
    refused('UNITS', () => computeShares(m(100), 'equal', [{ memberId: 'ana', units: 1 }], ORDER));
  });
});

describe('by amounts', () => {
  it('gives each the amount typed, which must add up to the expense', () => {
    const shares = computeShares(
      m(5_000),
      'amounts',
      [
        { memberId: 'ben', units: 2_000 },
        { memberId: 'ana', units: 3_000 },
      ],
      ORDER,
    );
    expect(shares).toEqual([
      { memberId: 'ana', amount: 3_000, units: 3_000 },
      { memberId: 'ben', amount: 2_000, units: 2_000 },
    ]);
  });

  it('refuses amounts that do not add up, or that are not more than zero', () => {
    refused('AMOUNTS_TOTAL', () =>
      computeShares(
        m(5_000),
        'amounts',
        [
          { memberId: 'ana', units: 2_000 },
          { memberId: 'ben', units: 2_999 },
        ],
        ORDER,
      ),
    );
    refused('UNITS', () =>
      computeShares(
        m(5_000),
        'amounts',
        [
          { memberId: 'ana', units: 5_000 },
          { memberId: 'ben', units: 0 },
        ],
        ORDER,
      ),
    );
    refused('UNITS', () =>
      computeShares(m(5_000), 'amounts', [{ memberId: 'ana', units: 4_999.5 }], ORDER),
    );
  });
});

describe('by percentages', () => {
  it('gives each their part of the amount, rounded down, the leftover in member order', () => {
    // 100.00 at 33.33% / 33.33% / 33.34%: 33.33, 33.33, 33.34 exactly, then nothing left.
    const shares = computeShares(
      m(10_000),
      'percentages',
      [
        { memberId: 'ana', units: 3_333 },
        { memberId: 'ben', units: 3_333 },
        { memberId: 'cy', units: 3_334 },
      ],
      ORDER,
    );
    expect(amounts(shares)).toEqual([3_333, 3_333, 3_334]);
    // 0.10 at 50% / 25% / 25%: 5, 2.5, 2.5 → 5, 2, 2 and one left, to the first.
    expect(
      amounts(
        computeShares(
          m(10),
          'percentages',
          [
            { memberId: 'ana', units: 5_000 },
            { memberId: 'ben', units: 2_500 },
            { memberId: 'cy', units: 2_500 },
          ],
          ORDER,
        ),
      ),
    ).toEqual([6, 2, 2]);
  });

  it('refuses percentages not totalling 100.00%', () => {
    refused('PERCENT_TOTAL', () =>
      computeShares(
        m(10_000),
        'percentages',
        [
          { memberId: 'ana', units: 5_000 },
          { memberId: 'ben', units: 4_999 },
        ],
        ORDER,
      ),
    );
    refused('PERCENT_TOTAL', () =>
      computeShares(
        m(10_000),
        'percentages',
        [
          { memberId: 'ana', units: 6_000 },
          { memberId: 'ben', units: 4_001 },
        ],
        ORDER,
      ),
    );
    refused('UNITS', () =>
      computeShares(m(10_000), 'percentages', [{ memberId: 'ana', units: 10_001 }], ORDER),
    );
  });
});

describe('by shares', () => {
  it('gives each the amount × their weight ÷ the total weight', () => {
    // 90.00 at 1, 1.5 and 0.5 shares: 30.00, 45.00, 15.00.
    expect(
      amounts(
        computeShares(
          m(9_000),
          'shares',
          [
            { memberId: 'ana', units: 100 },
            { memberId: 'ben', units: 150 },
            { memberId: 'cy', units: 50 },
          ],
          ORDER,
        ),
      ),
    ).toEqual([3_000, 4_500, 1_500]);
    // 10.00 at 1, 1, 1: as equally.
    expect(
      amounts(
        computeShares(
          m(1_000),
          'shares',
          ORDER.slice(0, 3).map((memberId) => ({ memberId, units: 100 })),
          ORDER,
        ),
      ),
    ).toEqual([334, 333, 333]);
  });

  it('refuses a weight of nothing, a fraction or a typo of a thousand thousand', () => {
    refused('UNITS', () => computeShares(m(100), 'shares', [{ memberId: 'ana', units: 0 }], ORDER));
    refused('UNITS', () =>
      computeShares(m(100), 'shares', [{ memberId: 'ana', units: 1.5 }], ORDER),
    );
    refused('UNITS', () =>
      computeShares(m(100), 'shares', [{ memberId: 'ana', units: 100_000_000 }], ORDER),
    );
  });
});

describe('what any split refuses', () => {
  it('an amount not more than zero, nobody, someone twice or not in the group', () => {
    const one = [{ memberId: 'ana', units: null }];
    refused('AMOUNT', () => computeShares(m(0), 'equal', one, ORDER));
    refused('AMOUNT', () => computeShares(m(-5), 'equal', one, ORDER));
    refused('AMOUNT', () => computeShares(12.5 as Minor, 'equal', one, ORDER));
    refused('EMPTY', () => computeShares(m(100), 'equal', [], ORDER));
    refused('DUPLICATE', () => computeShares(m(100), 'equal', [...one, ...one], ORDER));
    refused('NOT_A_MEMBER', () =>
      computeShares(m(100), 'equal', [{ memberId: 'eve', units: null }], ORDER),
    );
  });
});

describe('the server’s check', () => {
  it('accepts the shares the rule gives, in any order', () => {
    const shares = computeShares(
      m(10_000),
      'equal',
      ORDER.slice(0, 3).map((memberId) => ({ memberId, units: null })),
      ORDER,
    );
    expect(() => checkShares(m(10_000), 'equal', [...shares].reverse(), ORDER)).not.toThrow();
  });

  it('refuses shares rounded another way, even when they add up', () => {
    const otherRounding = [
      { memberId: 'ana', amount: m(3_333), units: null },
      { memberId: 'ben', amount: m(3_333), units: null },
      { memberId: 'cy', amount: m(3_334), units: null },
    ];
    refused('MISMATCH', () => checkShares(m(10_000), 'equal', otherRounding, ORDER));
  });
});

describe('payers', () => {
  it('must each have paid something, and together exactly the amount', () => {
    expect(
      checkPayers(
        m(8_400),
        [
          { memberId: 'ben', amount: m(400) },
          { memberId: 'ana', amount: m(8_000) },
        ],
        ORDER,
      ),
    ).toEqual([
      { memberId: 'ana', amount: 8_000 },
      { memberId: 'ben', amount: 400 },
    ]);
    refused('PAYERS_TOTAL', () =>
      checkPayers(m(8_400), [{ memberId: 'ana', amount: m(8_000) }], ORDER),
    );
    refused('UNITS', () =>
      checkPayers(
        m(8_400),
        [
          { memberId: 'ana', amount: m(8_400) },
          { memberId: 'ben', amount: m(0) },
        ],
        ORDER,
      ),
    );
    refused('EMPTY', () => checkPayers(m(8_400), [], ORDER));
    refused('NOT_A_MEMBER', () =>
      checkPayers(m(8_400), [{ memberId: 'eve', amount: m(8_400) }], ORDER),
    );
  });
});

describe('distribute', () => {
  it('divides a negative total as its opposite, and gives a zero weight nothing of the leftover', () => {
    expect(distribute(m(-100), [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(distribute(m(10), [0, 1, 1, 1])).toEqual([0, 4, 3, 3]);
  });

  it('is exact for amounts whose product with a weight passes what a number holds', () => {
    const big = m(Number.MAX_SAFE_INTEGER);
    const parts = distribute(big, [MAX_WEIGHT, MAX_WEIGHT, 1]);
    expect(parts.reduce((a, b) => BigInt(a) + BigInt(b), 0n)).toBe(BigInt(Number.MAX_SAFE_INTEGER));
  });
});
const MAX_WEIGHT = 100_000;

describe('properties', () => {
  const METHODS: SplitMethod[] = ['equal', 'amounts', 'percentages', 'shares'];

  function randomInputs(random: Random, amount: number, method: SplitMethod): SplitInput[] {
    const members = random.shuffle(ORDER).slice(0, random.int(1, ORDER.length));
    switch (method) {
      case 'equal':
        return members.map((memberId) => ({ memberId, units: null }));
      case 'shares':
        return members.map((memberId) => ({ memberId, units: random.int(1, 1_000) }));
      case 'percentages': {
        // Cut 100.00% into as many positive parts as there are members.
        const cuts = new Set<number>();
        while (cuts.size < members.length - 1) cuts.add(random.int(1, 9_999));
        const points = [0, ...[...cuts].sort((a, b) => a - b), 10_000];
        return members.map((memberId, i) => ({
          memberId,
          units: (points[i + 1] ?? 0) - (points[i] ?? 0),
        }));
      }
      case 'amounts': {
        if (amount < members.length)
          return members.slice(0, 1).map((memberId) => ({ memberId, units: amount }));
        const cuts = new Set<number>();
        while (cuts.size < members.length - 1) cuts.add(random.int(1, amount - 1));
        const points = [0, ...[...cuts].sort((a, b) => a - b), amount];
        return members.map((memberId, i) => ({
          memberId,
          units: (points[i + 1] ?? 0) - (points[i] ?? 0),
        }));
      }
    }
  }

  it('shares always add up to the amount, never go below zero, and do not depend on the input’s order', () => {
    forSeeds(2_000, (random) => {
      const amount = random.chance(0.2) ? random.int(1, 10) : random.int(1, 10_000_000);
      const method = random.pick(METHODS);
      const inputs = randomInputs(random, amount, method);
      const shares = computeShares(m(amount), method, inputs, ORDER);
      expect(shares.reduce((sum, s) => sum + s.amount, 0)).toBe(amount);
      expect(shares.every((s) => s.amount >= 0)).toBe(true);
      expect(computeShares(m(amount), method, random.shuffle(inputs), ORDER)).toEqual(shares);
      expect(() => checkShares(m(amount), method, random.shuffle(shares), ORDER)).not.toThrow();
    });
  });

  it('no share is more than one unit from its exact part', () => {
    forSeeds(1_000, (random) => {
      const amount = random.int(1, 1_000_000);
      const weights = Array.from({ length: random.int(1, 8) }, () => random.int(1, 500));
      const parts = distribute(m(amount), weights);
      const total = weights.reduce((a, b) => a + b, 0);
      parts.forEach((part, i) => {
        // A float only to bound the test's expectation, never as an amount.
        const exact = (amount * (weights[i] ?? 0)) / total;
        expect(part).toBeGreaterThanOrEqual(Math.floor(exact));
        expect(part).toBeLessThanOrEqual(Math.floor(exact) + 1);
      });
    });
  });
});
