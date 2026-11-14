import { describe, expect, it } from 'vitest';
import { toMinor } from '../money/amount';
import { computeShares } from '../money/split';
import { type SharedGroup, betweenTwo, position, settleWithPerson, totalBetween } from './across';
import { type BalanceExpense, type GroupRows, balances } from './index';

/**
 * Across groups (DESIGN.md §10.4), hand-worked: Ana and Ben share Lisbon (in euros) and Tokyo (in yen and euros). Never a figure in two currencies;
 * settling up with a person is one payment per group and currency, and zeroes every pair.
 */
const m = toMinor;
function expense(
  order: string[],
  currency: string,
  amount: number,
  payer: string,
  between: string[],
): BalanceExpense {
  return {
    currency,
    payers: [{ memberId: payer, amount: m(amount) }],
    shares: computeShares(
      m(amount),
      'equal',
      between.map((memberId) => ({ memberId, units: null })),
      order,
    ),
  };
}

// Lisbon: Ana (la) paid €90.00 for Ana, Ben (lb) and Cy (lc): Ben owes Ana €30.00. Ben paid €10.00 for Ana and Ben: Ana owes Ben €5.00. Net, Ben owes Ana €25.00.
const lisbonOrder = ['la', 'lb', 'lc'];
const lisbon: GroupRows = {
  expenses: [
    expense(lisbonOrder, 'EUR', 9_000, 'la', ['la', 'lb', 'lc']),
    expense(lisbonOrder, 'EUR', 1_000, 'lb', ['la', 'lb']),
  ],
  payments: [],
};
// Tokyo: Ben (tb) paid ¥3,000 for both: Ana owes Ben ¥1,500. Ana (ta) paid €8.00 for both: Ben owes Ana €4.00.
const tokyoOrder = ['ta', 'tb'];
const tokyo: GroupRows = {
  expenses: [
    expense(tokyoOrder, 'JPY', 3_000, 'tb', ['ta', 'tb']),
    expense(tokyoOrder, 'EUR', 800, 'ta', ['ta', 'tb']),
  ],
  payments: [],
};
const [lisbonGroup, tokyoGroup]: [SharedGroup, SharedGroup] = [
  { groupId: 'lisbon', rows: lisbon, order: lisbonOrder, simplify: false, me: 'la', them: 'lb' },
  { groupId: 'tokyo', rows: tokyo, order: tokyoOrder, simplify: false, me: 'ta', them: 'tb' },
];
const groups = [lisbonGroup, tokyoGroup];

describe('across groups', () => {
  it('gives what lies between two people per group and currency, never in one figure', () => {
    expect(betweenTwo(groups)).toEqual([
      { groupId: 'lisbon', currency: 'EUR', amount: 2_500 },
      { groupId: 'tokyo', currency: 'EUR', amount: 400 },
      { groupId: 'tokyo', currency: 'JPY', amount: -1_500 },
    ]);
    expect([...totalBetween(betweenTwo(groups))]).toEqual([
      ['EUR', 2_900],
      ['JPY', -1_500],
    ]);
  });

  it('with simplify on in a group, gives the suggested payments between the two there', () => {
    // In Lisbon simplified: Ana is owed 55.00 (90 − 30 − 5), Ben owes 25.00, Cy owes 30.00; Cy pays Ana 30.00 and Ben pays Ana 25.00.
    expect(betweenTwo([{ ...lisbonGroup, simplify: true }])).toEqual([
      { groupId: 'lisbon', currency: 'EUR', amount: 2_500 },
    ]);
    // Cy, simplified, owes Ana 30.00; between Ana and Cy pairwise it is the same.
    expect(betweenTwo([{ ...lisbonGroup, them: 'lc', simplify: true }])).toEqual([
      { groupId: 'lisbon', currency: 'EUR', amount: 3_000 },
    ]);
  });

  it('gives the reader’s position per currency, owed and owing apart, the primary currency first', () => {
    const views = [
      { balances: balances(lisbon, lisbonOrder), me: 'la' },
      { balances: balances(tokyo, tokyoOrder), me: 'ta' },
    ];
    // Lisbon: Ana +55.00 EUR. Tokyo: Ana +4.00 EUR, −¥1,500.
    expect(position(views, 'JPY')).toEqual([
      { currency: 'JPY', owed: 0, owing: 1_500 },
      { currency: 'EUR', owed: 5_900, owing: 0 },
    ]);
    expect(position(views, 'EUR').map((p) => p.currency)).toEqual(['EUR', 'JPY']);
  });

  it('settles up with a person in one payment per group and currency, each zeroing that pair', () => {
    const payments = settleWithPerson(groups);
    expect(payments).toEqual([
      { groupId: 'lisbon', currency: 'EUR', fromMemberId: 'lb', toMemberId: 'la', amount: 2_500 },
      { groupId: 'tokyo', currency: 'EUR', fromMemberId: 'tb', toMemberId: 'ta', amount: 400 },
      { groupId: 'tokyo', currency: 'JPY', fromMemberId: 'ta', toMemberId: 'tb', amount: 1_500 },
    ]);
    const settled = groups.map((g) => ({
      ...g,
      rows: {
        ...g.rows,
        payments: [
          ...g.rows.payments,
          ...payments
            .filter((p) => p.groupId === g.groupId)
            .map((p) => ({
              currency: p.currency,
              fromId: p.fromMemberId,
              toId: p.toMemberId,
              amount: p.amount,
            })),
        ],
      },
    }));
    expect(betweenTwo(settled)).toEqual([]);
  });

  it('is nothing with someone who is not in a group', () => {
    expect(betweenTwo([{ ...lisbonGroup, them: undefined } as SharedGroup])).toEqual([]);
  });
});
