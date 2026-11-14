'use client';

import { useMemo, useState } from 'react';
import { EmptyState, PageContainer, PageHeader, Select } from '@sovereignfs/ui';
import {
  type InCurrency,
  type SpendingGroup,
  groupSpendingByCategory,
  groupSpendingByMonth,
  memberShares,
  monthsEnding,
  mySpendingByCategory,
  mySpendingByGroup,
  mySpendingByMonth,
} from '../insights';
import { toMinor } from '../money/amount';
import { formatMoney } from '../money/text';
import { useMe } from '../sync/react';
import { BarChart, type ChartRow, MonthChart } from '../ui/charts/Charts';
import { CATEGORY_VIEW } from './categories';
import type { GroupView } from './data';
import { useGroupNames } from './hooks';
import { useGroupViews } from './useGroups';
import styles from './Screens.module.css';

/**
 * **Insights** (DESIGN.md §13, §15.5): what was spent, as each person's share, per currency, never converted, from the device's rows (offline too),
 * through `src/insights/`. `/insights` is the reader's own: by category for a month (a month picker), by month for the twelve ending with it, and by
 * group. A group's Insights view is the group's: by category, by month, and each member's share. A currency switch appears when there is more than one;
 * every chart has a table of the same figures beside it (`src/ui/charts/`).
 */
const thisMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};
const monthWords = (month: string, style: 'long' | 'short') =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: style === 'long' ? 'long' : 'short',
    ...(style === 'long' ? { year: 'numeric' } : {}),
  }).format(new Date(`${month}-01T00:00:00Z`));
const money = (amount: number, currency: string) => formatMoney(toMinor(amount), currency);
const categoryLabel = (category: string) =>
  CATEGORY_VIEW[category as keyof typeof CATEGORY_VIEW]?.label ?? category;

function pick<Row>(figures: InCurrency<Row>[], currency: string): InCurrency<Row> | undefined {
  return figures.find((f) => f.currency === currency);
}

/** The currencies in any of the figures, in their order (primary first), and the one chosen. */
function useCurrency(all: InCurrency<unknown>[][]) {
  const currencies = [...new Set(all.flatMap((figures) => figures.map((f) => f.currency)))];
  const [chosen, setChosen] = useState<string | null>(null);
  const currency = chosen && currencies.includes(chosen) ? chosen : (currencies[0] ?? '');
  const picker =
    currencies.length > 1 ? (
      <Select
        aria-label="Currency"
        value={currency}
        onChange={(event) => setChosen(event.target.value)}
      >
        {currencies.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
    ) : null;
  return { currency, picker };
}

function monthRows(
  figures: InCurrency<{ month: string; amount: number }> | undefined,
  currency: string,
): ChartRow[] {
  return (figures?.rows ?? []).map((r) => ({
    key: r.month,
    label: monthWords(r.month, 'long'),
    value: r.amount,
    valueLabel: money(r.amount, currency),
  }));
}

const shortMonth = (row: ChartRow) => monthWords(row.key, 'short').slice(0, 1);

export function InsightsPage() {
  const me = useMe();
  const views = useGroupViews();
  const names = useGroupNames(views?.map((v) => v.group) ?? []);
  const [month, setMonth] = useState(thisMonth);
  const primary = me?.primaryCurrency ?? 'EUR';
  const groups: SpendingGroup[] = useMemo(
    () =>
      (views ?? []).map((v) => ({
        groupId: v.group.id,
        me: v.me?.id ?? null,
        expenses: v.expenses,
      })),
    [views],
  );
  const byCategory = useMemo(
    () => mySpendingByCategory(groups, month, primary),
    [groups, month, primary],
  );
  const byMonth = useMemo(
    () => mySpendingByMonth(groups, month, primary),
    [groups, month, primary],
  );
  const byGroup = useMemo(() => mySpendingByGroup(groups, primary), [groups, primary]);
  const { currency, picker } = useCurrency([byCategory, byMonth, byGroup]);
  if (!views) return null;

  const category = pick(byCategory, currency);
  const months = pick(byMonth, currency);
  const inGroups = pick(byGroup, currency);
  const anything = byGroup.length > 0;

  return (
    <PageContainer>
      <PageHeader
        title="Insights"
        description="What you spent, by category, month and group: your share of each expense."
      />
      {!anything ? (
        <EmptyState
          icon="layout-dashboard"
          heading="Nothing to show yet"
          description="Once you share an expense, what you spent shows here."
        />
      ) : (
        <div className={styles.stack}>
          <div className={styles.row}>
            <Select
              aria-label="Month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            >
              {monthsEnding(thisMonth(), 24)
                .reverse()
                .map((m) => (
                  <option key={m} value={m}>
                    {monthWords(m, 'long')}
                  </option>
                ))}
            </Select>
            {picker}
          </div>
          <section className={styles.stack} aria-label="By category">
            <h2 className={styles.small}>By category, {monthWords(month, 'long')}</h2>
            {category ? (
              <BarChart
                caption={`What you spent by category in ${monthWords(month, 'long')}, in ${currency}`}
                head={['Category', 'Spent']}
                rows={category.rows.map((r) => ({
                  key: r.category,
                  label: categoryLabel(r.category),
                  value: r.amount,
                  valueLabel: money(r.amount, currency),
                }))}
                total={money(category.total, currency)}
              />
            ) : (
              <p className={styles.muted}>Nothing spent in {currency} that month.</p>
            )}
          </section>
          <section className={styles.stack} aria-label="By month">
            <h2 className={styles.small}>By month</h2>
            {months ? (
              <MonthChart
                caption={`What you spent each month, the twelve to ${monthWords(month, 'long')}, in ${currency}`}
                rows={monthRows(months, currency)}
                short={shortMonth}
                total={money(months.total, currency)}
              />
            ) : (
              <p className={styles.muted}>Nothing spent in {currency} in those twelve months.</p>
            )}
          </section>
          <section className={styles.stack} aria-label="By group">
            <h2 className={styles.small}>By group</h2>
            {inGroups ? (
              <BarChart
                caption={`What you spent in each group, in ${currency}`}
                head={['Group', 'Spent']}
                rows={inGroups.rows.map((r) => ({
                  key: r.groupId,
                  label: names[r.groupId] ?? 'A group',
                  value: r.amount,
                  valueLabel: money(r.amount, currency),
                }))}
                total={money(inGroups.total, currency)}
              />
            ) : (
              <p className={styles.muted}>Nothing spent in {currency}.</p>
            )}
          </section>
        </div>
      )}
    </PageContainer>
  );
}

/** A group's Insights view: the group's spending by category and by month, and each member's share. */
export function GroupInsights({ view }: { view: GroupView }) {
  const me = useMe();
  const primary = me?.primaryCurrency ?? view.group.defaultCurrency;
  const last = thisMonth();
  const byCategory = useMemo(
    () => groupSpendingByCategory(view.expenses, primary),
    [view.expenses, primary],
  );
  const byMonth = useMemo(
    () => groupSpendingByMonth(view.expenses, last, primary),
    [view.expenses, last, primary],
  );
  const byMember = useMemo(
    () => memberShares(view.expenses, view.order, primary),
    [view.expenses, view.order, primary],
  );
  const { currency, picker } = useCurrency([byCategory, byMonth, byMember]);
  const nameOf = (id: string) =>
    id === view.me?.id ? 'You' : (view.members.find((m) => m.id === id)?.name ?? 'Someone');

  if (byCategory.length === 0)
    return (
      <EmptyState
        icon="layout-dashboard"
        heading="Nothing to show yet"
        description="Once an expense is added, what was spent shows here."
      />
    );
  const category = pick(byCategory, currency);
  const months = pick(byMonth, currency);
  const members = pick(byMember, currency);
  return (
    <section className={styles.stack} aria-label="Insights">
      {picker ? <div className={styles.row}>{picker}</div> : null}
      <section className={styles.stack} aria-label="By category">
        <h2 className={styles.small}>By category</h2>
        {category ? (
          <BarChart
            caption={`What the group spent by category, in ${currency}`}
            head={['Category', 'Spent']}
            rows={category.rows.map((r) => ({
              key: r.category,
              label: categoryLabel(r.category),
              value: r.amount,
              valueLabel: money(r.amount, currency),
            }))}
            total={money(category.total, currency)}
          />
        ) : null}
      </section>
      <section className={styles.stack} aria-label="By month">
        <h2 className={styles.small}>By month</h2>
        {months ? (
          <MonthChart
            caption={`What the group spent each month, the last twelve, in ${currency}`}
            rows={monthRows(months, currency)}
            short={shortMonth}
            total={money(months.total, currency)}
          />
        ) : (
          <p className={styles.muted}>Nothing spent in {currency} in the last twelve months.</p>
        )}
      </section>
      <section className={styles.stack} aria-label="Each member’s share">
        <h2 className={styles.small}>Each member’s share</h2>
        {members ? (
          <BarChart
            caption={`Each member’s share of what the group spent, in ${currency}`}
            head={['Member', 'Share']}
            rows={members.rows.map((r) => ({
              key: r.memberId,
              label: nameOf(r.memberId),
              value: r.amount,
              valueLabel: money(r.amount, currency),
            }))}
            total={money(members.total, currency)}
          />
        ) : null}
      </section>
    </section>
  );
}
