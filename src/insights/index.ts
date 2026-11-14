import { CATEGORIES } from '../actions/categories';
import { type Minor, ZERO, addMinor, toMinor } from '../money/amount';

/**
 * **Spending** (DESIGN.md §13): every spending figure, pure, over the device's rows, so that it works offline; the screens, the server and the tests
 * share these and no figure has a second implementation.
 *
 *  - **Spending is a share,** not what was paid: buying dinner for four is a quarter of it spent by each of the four, and nothing more by the buyer.
 *  - **Per currency, never converted,** and no figure blends two: each answer is a list of currencies, the primary one first, then by code.
 *  - **A month is read from an expense's own date** (`YYYY-MM-DD`), so no time zone is involved.
 *  - A deleted expense counts for nothing; a payment is not spending.
 */
export interface SpendingExpense {
  /** `YYYY-MM-DD`, the expense's own date. */
  date: string;
  currency: string;
  category: string;
  deletedAt: number | null;
  shares: readonly { memberId: string; amount: number }[];
}

export interface SpendingGroup {
  groupId: string;
  /** The reader's member in the group, or `null` when they are not in it. */
  me: string | null;
  expenses: readonly SpendingExpense[];
}

/** One currency's figures: its total, and its rows. */
export interface InCurrency<Row> {
  currency: string;
  total: Minor;
  rows: Row[];
}

export interface CategoryRow {
  category: string;
  amount: Minor;
}
export interface MonthRow {
  /** `YYYY-MM` */
  month: string;
  amount: Minor;
}
export interface GroupRow {
  groupId: string;
  amount: Minor;
}
export interface MemberRow {
  memberId: string;
  amount: Minor;
}

const monthOf = (date: string) => date.slice(0, 7);

/** The `n` months ending with `last` (`YYYY-MM`), oldest first. */
export function monthsEnding(last: string, n: number): string[] {
  const [year = 1970, month = 1] = last.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const index = year * 12 + (month - 1) - i;
    out.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

/** The currencies of a set of figures, the primary first, then by code. */
function ordered<Row>(
  byCurrency: Map<string, InCurrency<Row>>,
  primary: string,
): InCurrency<Row>[] {
  return [...byCurrency.values()].sort(
    (a, b) =>
      Number(b.currency === primary) - Number(a.currency === primary) ||
      (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0),
  );
}

/** Adds `amount` to `key` of `currency`, keeping each currency's total. */
function tally(
  into: Map<string, { total: Minor; by: Map<string, Minor> }>,
  currency: string,
  key: string,
  amount: Minor,
) {
  const bucket = into.get(currency) ?? { total: ZERO, by: new Map<string, Minor>() };
  bucket.total = addMinor(bucket.total, amount);
  bucket.by.set(key, addMinor(bucket.by.get(key) ?? ZERO, amount));
  into.set(currency, bucket);
}

const live = (expenses: readonly SpendingExpense[]) => expenses.filter((e) => e.deletedAt === null);
const categoryPlace = (category: string) => {
  const at = (CATEGORIES as readonly string[]).indexOf(category);
  return at === -1 ? CATEGORIES.length : at;
};
/** Largest first; ties in the order of the categories. */
const byAmountThenCategory = (a: CategoryRow, b: CategoryRow) =>
  b.amount - a.amount || categoryPlace(a.category) - categoryPlace(b.category);

/** The reader's share of each expense, with it, across groups. */
function myShares(groups: readonly SpendingGroup[]) {
  const out: { groupId: string; expense: SpendingExpense; amount: Minor }[] = [];
  for (const group of groups) {
    if (!group.me) continue;
    for (const expense of live(group.expenses)) {
      const share = expense.shares.find((s) => s.memberId === group.me);
      if (share && share.amount !== 0)
        out.push({ groupId: group.groupId, expense, amount: toMinor(share.amount) });
    }
  }
  return out;
}

function categoryFigures(
  items: readonly { expense: SpendingExpense; amount: Minor }[],
  primary: string,
): InCurrency<CategoryRow>[] {
  const into = new Map<string, { total: Minor; by: Map<string, Minor> }>();
  for (const { expense, amount } of items) tally(into, expense.currency, expense.category, amount);
  const result = new Map<string, InCurrency<CategoryRow>>();
  for (const [currency, { total, by }] of into)
    result.set(currency, {
      currency,
      total,
      rows: [...by].map(([category, amount]) => ({ category, amount })).sort(byAmountThenCategory),
    });
  return ordered(result, primary);
}

function monthFigures(
  items: readonly { expense: SpendingExpense; amount: Minor }[],
  last: string,
  count: number,
  primary: string,
): InCurrency<MonthRow>[] {
  const months = monthsEnding(last, count);
  const inRange = new Set(months);
  const into = new Map<string, { total: Minor; by: Map<string, Minor> }>();
  for (const { expense, amount } of items) {
    const month = monthOf(expense.date);
    if (inRange.has(month)) tally(into, expense.currency, month, amount);
  }
  const result = new Map<string, InCurrency<MonthRow>>();
  for (const [currency, { total, by }] of into)
    result.set(currency, {
      currency,
      total,
      rows: months.map((month) => ({ month, amount: by.get(month) ?? ZERO })),
    });
  return ordered(result, primary);
}

/** **The reader's spending by category** in a month (`YYYY-MM`), across their groups. */
export function mySpendingByCategory(
  groups: readonly SpendingGroup[],
  month: string,
  primary: string,
): InCurrency<CategoryRow>[] {
  return categoryFigures(
    myShares(groups).filter((s) => monthOf(s.expense.date) === month),
    primary,
  );
}

/** **The reader's spending by month,** the `count` months ending with `last` (twelve by default), every month listed, oldest first. */
export function mySpendingByMonth(
  groups: readonly SpendingGroup[],
  last: string,
  primary: string,
  count = 12,
): InCurrency<MonthRow>[] {
  return monthFigures(myShares(groups), last, count, primary);
}

/** **The reader's spending by group,** over everything, or a month's when one is given; largest first. */
export function mySpendingByGroup(
  groups: readonly SpendingGroup[],
  primary: string,
  month?: string,
): InCurrency<GroupRow>[] {
  const into = new Map<string, { total: Minor; by: Map<string, Minor> }>();
  for (const share of myShares(groups))
    if (month === undefined || monthOf(share.expense.date) === month)
      tally(into, share.expense.currency, share.groupId, share.amount);
  const result = new Map<string, InCurrency<GroupRow>>();
  for (const [currency, { total, by }] of into)
    result.set(currency, {
      currency,
      total,
      rows: [...by]
        .map(([groupId, amount]) => ({ groupId, amount }))
        .sort((a, b) => b.amount - a.amount || (a.groupId < b.groupId ? -1 : 1)),
    });
  return ordered(result, primary);
}

/** Every share of a group's expenses: the group's spending is what its members spent. */
function groupShares(expenses: readonly SpendingExpense[]) {
  return live(expenses).flatMap((expense) =>
    expense.shares.map((s) => ({ expense, memberId: s.memberId, amount: toMinor(s.amount) })),
  );
}

/** **A group's spending by category,** over everything or in a month. */
export function groupSpendingByCategory(
  expenses: readonly SpendingExpense[],
  primary: string,
  month?: string,
): InCurrency<CategoryRow>[] {
  return categoryFigures(
    groupShares(expenses).filter((s) => month === undefined || monthOf(s.expense.date) === month),
    primary,
  );
}

/** **A group's spending by month,** the `count` months ending with `last`. */
export function groupSpendingByMonth(
  expenses: readonly SpendingExpense[],
  last: string,
  primary: string,
  count = 12,
): InCurrency<MonthRow>[] {
  return monthFigures(groupShares(expenses), last, count, primary);
}

/** **Each member's share of a group's spending,** over everything or in a month; largest first, then in `order` (the group's member order). */
export function memberShares(
  expenses: readonly SpendingExpense[],
  order: readonly string[],
  primary: string,
  month?: string,
): InCurrency<MemberRow>[] {
  const into = new Map<string, { total: Minor; by: Map<string, Minor> }>();
  for (const share of groupShares(expenses))
    if (month === undefined || monthOf(share.expense.date) === month)
      tally(into, share.expense.currency, share.memberId, share.amount);
  const place = (id: string) => {
    const at = order.indexOf(id);
    return at === -1 ? order.length : at;
  };
  const result = new Map<string, InCurrency<MemberRow>>();
  for (const [currency, { total, by }] of into)
    result.set(currency, {
      currency,
      total,
      rows: [...by]
        .map(([memberId, amount]) => ({ memberId, amount }))
        .sort((a, b) => b.amount - a.amount || place(a.memberId) - place(b.memberId)),
    });
  return ordered(result, primary);
}
