import { describe, expect, it } from 'vitest';
import {
  type SpendingExpense,
  type SpendingGroup,
  groupSpendingByCategory,
  groupSpendingByMonth,
  memberShares,
  monthsEnding,
  mySpendingByCategory,
  mySpendingByGroup,
  mySpendingByMonth,
} from './index';

/**
 * Spending (DESIGN.md §13), against a fixture worked by hand: two groups, two currencies. Every figure below was added up on paper from the rows, not
 * from the code under test.
 *
 * Lisbon (Ada, Ben, Cy, Dee), Ada is `l-ada`:
 *   1. 2026-11-03 eating out, €100.00 for the four, Ada paid it all: €25.00 each. Ada spent a quarter, not the hundred.
 *   2. 2026-11-10 transport, €9.60, Ada and Ben: €4.80 each.
 *   3. 2026-10-20 groceries, €30.01, Ada, Ben, Cy: €10.01, €10.00, €10.00 (the cent left over to the first).
 *   4. 2026-11-05 eating out, ¥3,000, Ada, Ben, Cy: ¥1,000 each.
 *   5. 2026-11-06 general, €500.00, Ada alone: deleted, so nothing.
 *   6. 2026-11-12 travel, €40.00, Ben and Cy (Ada paid): €20.00 each; nothing of Ada's.
 * Flat (Ada, Eve), Ada is `f-ada`:
 *   7. 2026-11-01 rent, €1,200.00, halves: €600.00 each.
 *   8. 2025-11-15 utilities, €80.00, halves: €40.00 each, thirteen months before November 2026.
 *   9. 2026-11-20 groceries, €12.00, Eve alone.
 * Porto, which Ada is not in: €999.00 of general, none of it hers.
 */
const e = (
  date: string,
  currency: string,
  category: string,
  shares: Record<string, number>,
  deletedAt: number | null = null,
): SpendingExpense => ({
  date,
  currency,
  category,
  deletedAt,
  shares: Object.entries(shares).map(([memberId, amount]) => ({ memberId, amount })),
});

const lisbon: SpendingExpense[] = [
  e('2026-11-03', 'EUR', 'eating_out', {
    'l-ada': 2500,
    'l-ben': 2500,
    'l-cy': 2500,
    'l-dee': 2500,
  }),
  e('2026-11-10', 'EUR', 'transport', { 'l-ada': 480, 'l-ben': 480 }),
  e('2026-10-20', 'EUR', 'groceries', { 'l-ada': 1001, 'l-ben': 1000, 'l-cy': 1000 }),
  e('2026-11-05', 'JPY', 'eating_out', { 'l-ada': 1000, 'l-ben': 1000, 'l-cy': 1000 }),
  e('2026-11-06', 'EUR', 'general', { 'l-ada': 50000 }, 1),
  e('2026-11-12', 'EUR', 'travel', { 'l-ben': 2000, 'l-cy': 2000 }),
];
const flat: SpendingExpense[] = [
  e('2026-11-01', 'EUR', 'rent', { 'f-ada': 60000, 'f-eve': 60000 }),
  e('2025-11-15', 'EUR', 'utilities', { 'f-ada': 4000, 'f-eve': 4000 }),
  e('2026-11-20', 'EUR', 'groceries', { 'f-eve': 1200 }),
];
const groups: SpendingGroup[] = [
  { groupId: 'lisbon', me: 'l-ada', expenses: lisbon },
  { groupId: 'flat', me: 'f-ada', expenses: flat },
  { groupId: 'porto', me: null, expenses: [e('2026-11-02', 'EUR', 'general', { 'p-zed': 99900 })] },
];

describe('the reader’s spending', () => {
  it('buying dinner for four is a quarter of it spent', () => {
    const dinner: SpendingGroup[] = [
      { groupId: 'lisbon', me: 'l-ada', expenses: [lisbon[0] as SpendingExpense] },
    ];
    expect(mySpendingByCategory(dinner, '2026-11', 'EUR')).toEqual([
      { currency: 'EUR', total: 2500, rows: [{ category: 'eating_out', amount: 2500 }] },
    ]);
  });

  it('by category for a month, per currency, the primary first; deleted, others’ and other months’ left out', () => {
    expect(mySpendingByCategory(groups, '2026-11', 'EUR')).toEqual([
      {
        currency: 'EUR',
        total: 62980,
        rows: [
          { category: 'rent', amount: 60000 },
          { category: 'eating_out', amount: 2500 },
          { category: 'transport', amount: 480 },
        ],
      },
      { currency: 'JPY', total: 1000, rows: [{ category: 'eating_out', amount: 1000 }] },
    ]);
    expect(mySpendingByCategory(groups, '2026-11', 'JPY').map((c) => c.currency)).toEqual([
      'JPY',
      'EUR',
    ]);
    expect(mySpendingByCategory(groups, '2026-10', 'EUR')).toEqual([
      { currency: 'EUR', total: 1001, rows: [{ category: 'groceries', amount: 1001 }] },
    ]);
    expect(mySpendingByCategory(groups, '2026-09', 'EUR')).toEqual([]);
  });

  it('by month, the twelve ending with the one given, every month listed', () => {
    const [eur, jpy] = mySpendingByMonth(groups, '2026-11', 'EUR');
    expect(eur?.currency).toBe('EUR');
    expect(eur?.total).toBe(63981);
    expect(eur?.rows).toHaveLength(12);
    expect(eur?.rows[0]).toEqual({ month: '2025-12', amount: 0 });
    expect(eur?.rows.slice(-2)).toEqual([
      { month: '2026-10', amount: 1001 },
      { month: '2026-11', amount: 62980 },
    ]);
    // November 2025's utilities are thirteen months back: outside.
    expect(eur?.rows.map((r) => r.month)).not.toContain('2025-11');
    expect(jpy).toMatchObject({ currency: 'JPY', total: 1000 });
    expect(jpy?.rows.filter((r) => r.amount !== 0)).toEqual([{ month: '2026-11', amount: 1000 }]);
  });

  it('by group, over everything or a month, largest first', () => {
    expect(mySpendingByGroup(groups, 'EUR')).toEqual([
      {
        currency: 'EUR',
        total: 67981,
        rows: [
          { groupId: 'flat', amount: 64000 },
          { groupId: 'lisbon', amount: 3981 },
        ],
      },
      { currency: 'JPY', total: 1000, rows: [{ groupId: 'lisbon', amount: 1000 }] },
    ]);
    expect(mySpendingByGroup(groups, 'EUR', '2026-10')).toEqual([
      { currency: 'EUR', total: 1001, rows: [{ groupId: 'lisbon', amount: 1001 }] },
    ]);
  });
});

describe('a group’s spending', () => {
  it('by category: everyone’s shares together, per currency', () => {
    expect(groupSpendingByCategory(lisbon, 'EUR')).toEqual([
      {
        currency: 'EUR',
        total: 17961,
        rows: [
          { category: 'eating_out', amount: 10000 },
          { category: 'travel', amount: 4000 },
          { category: 'groceries', amount: 3001 },
          { category: 'transport', amount: 960 },
        ],
      },
      { currency: 'JPY', total: 3000, rows: [{ category: 'eating_out', amount: 3000 }] },
    ]);
  });

  it('by month', () => {
    expect(groupSpendingByMonth(lisbon, '2026-11', 'EUR', 3)).toEqual([
      {
        currency: 'EUR',
        total: 17961,
        rows: [
          { month: '2026-09', amount: 0 },
          { month: '2026-10', amount: 3001 },
          { month: '2026-11', amount: 14960 },
        ],
      },
      {
        currency: 'JPY',
        total: 3000,
        rows: [
          { month: '2026-09', amount: 0 },
          { month: '2026-10', amount: 0 },
          { month: '2026-11', amount: 3000 },
        ],
      },
    ]);
  });

  it('each member’s share, largest first, a tie in the group’s order', () => {
    const order = ['l-ada', 'l-ben', 'l-cy', 'l-dee'];
    expect(memberShares(lisbon, order, 'EUR')).toEqual([
      {
        currency: 'EUR',
        total: 17961,
        rows: [
          { memberId: 'l-ben', amount: 5980 },
          { memberId: 'l-cy', amount: 5500 },
          { memberId: 'l-ada', amount: 3981 },
          { memberId: 'l-dee', amount: 2500 },
        ],
      },
      {
        currency: 'JPY',
        total: 3000,
        rows: [
          { memberId: 'l-ada', amount: 1000 },
          { memberId: 'l-ben', amount: 1000 },
          { memberId: 'l-cy', amount: 1000 },
        ],
      },
    ]);
    expect(memberShares(lisbon, order, 'EUR', '2026-10')[0]?.rows).toEqual([
      { memberId: 'l-ada', amount: 1001 },
      { memberId: 'l-ben', amount: 1000 },
      { memberId: 'l-cy', amount: 1000 },
    ]);
  });
});

describe('months', () => {
  it('counts back across a year', () => {
    expect(monthsEnding('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(monthsEnding('2026-12', 1)).toEqual(['2026-12']);
  });
});
