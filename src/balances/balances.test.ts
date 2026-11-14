import { describe, expect, it } from 'vitest';
import { type Minor, toMinor } from '../money/amount';
import { type SplitInput, type SplitMethod, computeShares } from '../money/split';
import { type Random, forSeeds } from '../testing/random';
import {
  type BalanceExpense,
  type BalancePayment,
  type GroupRows,
  asPayments,
  balanceOf,
  balances,
  pairwiseDebts,
  simplifiedPayments,
  suggestedPayments,
} from './index';

const m = (value: number) => toMinor(value);
const ORDER = ['ana', 'ben', 'cy', 'dee'];

function expense(
  currency: string,
  amount: number,
  payers: Record<string, number>,
  method: SplitMethod,
  inputs: SplitInput[],
  deleted = false,
): BalanceExpense {
  return {
    currency,
    deleted,
    payers: Object.entries(payers).map(([memberId, paid]) => ({ memberId, amount: m(paid) })),
    shares: computeShares(m(amount), method, inputs, ORDER),
  };
}
const equal = (...ids: string[]) => ids.map((memberId) => ({ memberId, units: null }));
const payment = (
  currency: string,
  fromId: string,
  toId: string,
  amount: number,
): BalancePayment => ({
  currency,
  fromId,
  toId,
  amount: m(amount),
});
const flat = (rows: { currency: string; fromId: string; toId: string; amount: Minor }[]) =>
  rows.map((d) => `${d.currency} ${d.fromId}→${d.toId} ${d.amount}`);

describe('a member’s balance', () => {
  it('is what they paid, less their shares, plus payments made, less payments received, per currency', () => {
    const rows: GroupRows = {
      expenses: [
        // Ana pays 90.00 for three: each owes 30.00.
        expense('EUR', 9_000, { ana: 9_000 }, 'equal', equal('ana', 'ben', 'cy')),
        // Ben and Cy pay 60.00 and 40.00 of 100.00, by percentages 50/25/25 of Ana, Ben, Cy.
        expense('EUR', 10_000, { ben: 6_000, cy: 4_000 }, 'percentages', [
          { memberId: 'ana', units: 5_000 },
          { memberId: 'ben', units: 2_500 },
          { memberId: 'cy', units: 2_500 },
        ]),
        // In yen, by shares: Dee pays ¥3,000 for Ana (2 shares) and Dee (1 share).
        expense('JPY', 3_000, { dee: 3_000 }, 'shares', [
          { memberId: 'ana', units: 200 },
          { memberId: 'dee', units: 100 },
        ]),
        // A deleted expense counts for nothing.
        expense('EUR', 50_000, { cy: 50_000 }, 'equal', equal('ana', 'cy'), true),
      ],
      // Ben pays Ana 5.00; a deleted payment counts for nothing.
      payments: [
        payment('EUR', 'ben', 'ana', 500),
        { ...payment('EUR', 'cy', 'ana', 999), deleted: true },
      ],
    };
    const table = balances(rows, ORDER);
    // Ana: +90 −30 −50 −5 = +5.00; Ben: +60 −30 −25 +5 = +10.00; Cy: +40 −30 −25 = −15.00.
    expect(balanceOf(table, 'EUR', 'ana')).toBe(500);
    expect(balanceOf(table, 'EUR', 'ben')).toBe(1_000);
    expect(balanceOf(table, 'EUR', 'cy')).toBe(-1_500);
    expect(balanceOf(table, 'EUR', 'dee')).toBe(0);
    // Yen stays yen: Ana owes ¥2,000; Dee is owed it.
    expect(balanceOf(table, 'JPY', 'ana')).toBe(-2_000);
    expect(balanceOf(table, 'JPY', 'dee')).toBe(2_000);
    expect([...table.keys()]).toEqual(['EUR', 'JPY']);
  });
});

describe('who owes whom, pairwise', () => {
  it('divides each share among the payers by what each paid, and nets each pair', () => {
    const rows: GroupRows = {
      expenses: [
        // 30.00 by Ana for Ana, Ben, Cy: Ben and Cy owe Ana 10.00 each.
        expense('EUR', 3_000, { ana: 3_000 }, 'equal', equal('ana', 'ben', 'cy')),
        // 10.00 paid 7.50 by Ben and 2.50 by Cy, for Ana alone: she owes Ben 7.50 and Cy 2.50.
        expense('EUR', 1_000, { ben: 750, cy: 250 }, 'amounts', [
          { memberId: 'ana', units: 1_000 },
        ]),
      ],
      payments: [],
    };
    // Ben: owes Ana 10.00, is owed 7.50 → owes 2.50. Cy: owes 10.00, is owed 2.50 → owes 7.50.
    expect(flat(pairwiseDebts(rows, ORDER))).toEqual(['EUR ben→ana 250', 'EUR cy→ana 750']);
  });

  it('a payment reduces the debt between its two directly, and can turn it round', () => {
    const rows: GroupRows = {
      expenses: [expense('EUR', 2_000, { ana: 2_000 }, 'equal', equal('ana', 'ben'))],
      payments: [payment('EUR', 'ben', 'ana', 1_500)],
    };
    // Ben owed 10.00 and paid 15.00: Ana now owes him 5.00.
    expect(flat(pairwiseDebts(rows, ORDER))).toEqual(['EUR ana→ben 500']);
  });

  it('rounds a share among several payers by the same rule, in member order', () => {
    // Shares of 0.01 among two payers of 0.01 each: rounded down to nothing, the cent goes to the first payer in member order (Ana), whatever order
    // the payers were listed in.
    const rows: GroupRows = {
      expenses: [
        expense('EUR', 3, { ben: 1, ana: 1, dee: 1 }, 'amounts', [{ memberId: 'cy', units: 3 }]),
        expense('EUR', 1, { ben: 1 }, 'amounts', [{ memberId: 'cy', units: 1 }]),
        expense('EUR', 2, { dee: 1, ana: 1 }, 'amounts', [
          { memberId: 'cy', units: 1 },
          { memberId: 'ben', units: 1 },
        ]),
      ],
      payments: [],
    };
    // Third, in member order: Ben's 0.01 among Ana and Dee (0.01 left each) → Ana; then Cy's 0.01 takes what is left, Dee's.
    expect(flat(pairwiseDebts(rows, ORDER))).toEqual([
      'EUR ben→ana 1',
      'EUR cy→ana 1',
      'EUR cy→ben 2',
      'EUR cy→dee 2',
    ]);
  });

  it('never names two currencies together', () => {
    const rows: GroupRows = {
      expenses: [
        expense('EUR', 1_000, { ana: 1_000 }, 'equal', equal('ana', 'ben')),
        expense('USD', 1_000, { ben: 1_000 }, 'equal', equal('ana', 'ben')),
      ],
      payments: [],
    };
    expect(flat(pairwiseDebts(rows, ORDER))).toEqual(['EUR ben→ana 500', 'USD ana→ben 500']);
  });
});

describe('who owes whom, simplified', () => {
  it('is the fewest payments: the largest debtor pays the largest creditor', () => {
    // Ana is owed 30, Ben 10; Cy owes 25, Dee 15.
    const table = new Map([
      [
        'EUR',
        new Map([
          ['ana', m(3_000)],
          ['ben', m(1_000)],
          ['cy', m(-2_500)],
          ['dee', m(-1_500)],
        ]),
      ],
    ]);
    expect(flat(simplifiedPayments(table, ORDER))).toEqual([
      'EUR cy→ana 2500',
      'EUR dee→ben 1000',
      'EUR dee→ana 500',
    ]);
  });

  it('breaks ties by member order', () => {
    const table = new Map([
      [
        'EUR',
        new Map([
          ['dee', m(500)],
          ['ben', m(500)],
          ['cy', m(-500)],
          ['ana', m(-500)],
        ]),
      ],
    ]);
    expect(flat(simplifiedPayments(table, ORDER))).toEqual(['EUR ana→ben 500', 'EUR cy→dee 500']);
  });

  it('can name two who never shared a bill, which pairwise never does', () => {
    const rows: GroupRows = {
      expenses: [
        expense('EUR', 2_000, { ana: 2_000 }, 'equal', equal('ana', 'ben')),
        expense('EUR', 2_000, { ben: 2_000 }, 'equal', equal('ben', 'cy')),
      ],
      payments: [],
    };
    expect(flat(suggestedPayments(rows, ORDER, false))).toEqual([
      'EUR ben→ana 1000',
      'EUR cy→ben 1000',
    ]);
    expect(flat(suggestedPayments(rows, ORDER, true))).toEqual(['EUR cy→ana 1000']);
  });
});

describe('properties', () => {
  const CURRENCIES = ['EUR', 'JPY', 'BHD'];
  const METHODS: SplitMethod[] = ['equal', 'amounts', 'percentages', 'shares'];

  function randomRows(random: Random): GroupRows {
    const expenses: BalanceExpense[] = [];
    const payments: BalancePayment[] = [];
    for (let i = random.int(0, 25); i > 0; i--) {
      const currency = random.pick(CURRENCIES);
      const amount = random.int(1, 500_000);
      const method = random.pick(METHODS);
      const members = random.shuffle(ORDER).slice(0, random.int(1, 4));
      let inputs: SplitInput[];
      if (method === 'equal') inputs = members.map((memberId) => ({ memberId, units: null }));
      else if (method === 'shares')
        inputs = members.map((memberId) => ({ memberId, units: random.int(1, 400) }));
      else {
        const whole = method === 'percentages' ? 10_000 : amount;
        const take = Math.min(members.length, whole);
        const cuts = new Set<number>();
        while (cuts.size < take - 1) cuts.add(random.int(1, whole - 1));
        const points = [0, ...[...cuts].sort((a, b) => a - b), whole];
        inputs = members.slice(0, take).map((memberId, j) => ({
          memberId,
          units: (points[j + 1] ?? 0) - (points[j] ?? 0),
        }));
      }
      const payerIds = random.shuffle(ORDER).slice(0, Math.min(random.int(1, 3), amount));
      const cuts = new Set<number>();
      while (cuts.size < payerIds.length - 1) cuts.add(random.int(1, amount - 1));
      const points = [0, ...[...cuts].sort((a, b) => a - b), amount];
      expenses.push({
        currency,
        deleted: random.chance(0.1),
        payers: payerIds.map((memberId, j) => ({
          memberId,
          amount: m((points[j + 1] ?? 0) - (points[j] ?? 0)),
        })),
        shares: computeShares(m(amount), method, inputs, ORDER),
      });
    }
    for (let i = random.int(0, 8); i > 0; i--) {
      const [fromId, toId] = random.shuffle(ORDER);
      payments.push({
        currency: random.pick(CURRENCIES),
        deleted: random.chance(0.1),
        fromId: fromId ?? 'ana',
        toId: toId ?? 'ben',
        amount: m(random.int(1, 100_000)),
      });
    }
    return { expenses, payments };
  }

  const settled = (rows: GroupRows) =>
    [...balances(rows, ORDER).values()].every((members) =>
      [...members.values()].every((v) => v === 0),
    );

  it('balances add up to zero in every currency', () => {
    forSeeds(500, (random) => {
      for (const members of balances(randomRows(random), ORDER).values())
        expect([...members.values()].reduce((a, b) => a + b, 0)).toBe(0);
    });
  });

  it('a member’s pairwise debts add up to their balance', () => {
    forSeeds(500, (random) => {
      const rows = randomRows(random);
      const table = balances(rows, ORDER);
      const debts = pairwiseDebts(rows, ORDER);
      for (const [currency, members] of table)
        for (const [id, balance] of members) {
          const owed = debts
            .filter((d) => d.currency === currency && d.toId === id)
            .reduce((a, d) => a + d.amount, 0);
          const owes = debts
            .filter((d) => d.currency === currency && d.fromId === id)
            .reduce((a, d) => a + d.amount, 0);
          expect(owed - owes).toBe(balance);
        }
    });
  });

  it('recording the suggestions settles everyone, simplified or not', () => {
    forSeeds(500, (random) => {
      const rows = randomRows(random);
      for (const simplify of [false, true]) {
        const suggestions = suggestedPayments(rows, ORDER, simplify);
        expect(suggestions.every((d) => d.amount > 0 && d.fromId !== d.toId)).toBe(true);
        const after = { ...rows, payments: [...rows.payments, ...asPayments(suggestions)] };
        expect(settled(after)).toBe(true);
        // Pairwise, every pair is settled too; simplified settles the balances, which can leave pairs that cancel only across people.
        if (!simplify) expect(pairwiseDebts(after, ORDER)).toEqual([]);
      }
    });
  });

  it('simplified needs fewer payments than there are people with a balance', () => {
    forSeeds(300, (random) => {
      const rows = randomRows(random);
      const simplified = suggestedPayments(rows, ORDER, true);
      for (const [currency, members] of balances(rows, ORDER)) {
        const people = [...members.values()].filter((v) => v !== 0).length;
        expect(simplified.filter((d) => d.currency === currency).length).toBeLessThanOrEqual(
          Math.max(0, people - 1),
        );
      }
    });
  });

  it('nothing depends on the order the rows arrived in', () => {
    forSeeds(300, (random) => {
      const rows = randomRows(random);
      const shuffled: GroupRows = {
        expenses: random.shuffle(rows.expenses).map((e) => ({
          ...e,
          payers: random.shuffle(e.payers),
          shares: random.shuffle(e.shares),
        })),
        payments: random.shuffle(rows.payments),
      };
      expect([...balances(shuffled, ORDER)].map(([c, ms]) => [c, [...ms]])).toEqual(
        [...balances(rows, ORDER)].map(([c, ms]) => [c, [...ms]]),
      );
      for (const simplify of [false, true])
        expect(suggestedPayments(shuffled, ORDER, simplify)).toEqual(
          suggestedPayments(rows, ORDER, simplify),
        );
    });
  });
});
