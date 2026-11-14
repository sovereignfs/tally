'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AvatarStack,
  ButtonLink,
  EmptyState,
  Icon,
  Input,
  PageContainer,
  Select,
  Tabs,
  Toggle,
} from '@sovereignfs/ui';
import { CATEGORIES, type Category } from '../actions/categories';
import type { LocalExpense, LocalPayment } from '../local/db';
import { pendingRows } from '../local/store';
import { toMinor } from '../money/amount';
import { formatMoney } from '../money/text';
import { useLocal, useMe } from '../sync/react';
import { sheetHref } from './AddSheet';
import { Balance, GroupDot } from './Balance';
import { CATEGORY_VIEW } from './categories';
import { type GroupView, myBalances, readGroupView } from './data';
import { useGroupNames, useOpened } from './hooks';
import styles from './Screens.module.css';

/**
 * **A group** (DESIGN.md §15.5): its header (the dot and name, the members, the reader's balance, Add expense, Settle up and the gear) and its views by
 * `?view=`: Expenses (this file), Balances (7.4), Activity (7.10). Everything is read from the device, so it paints at once and offline; a group the
 * reader is not in, or that the device does not hold, is not found.
 */
export type GroupViewName = 'expenses' | 'balances' | 'activity';

export function GroupScreen({
  groupId,
  views,
  settleUp = false,
}: {
  groupId: string;
  /** Whether Settle up is offered: it opens the payment sheet (7.5). */
  settleUp?: boolean;
  /** The views besides Expenses, drawn by their tasks. */
  views?: Partial<
    Record<
      Exclude<GroupViewName, 'expenses'>,
      (view: GroupView, name: string | undefined) => ReactNode
    >
  >;
}) {
  const me = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = useLocal(
    (db) => readGroupView(db, groupId, me?.personId ?? ''),
    [groupId, me?.personId],
  );
  const names = useGroupNames(view ? [view.group] : []);
  const current = (params.get('view') as GroupViewName | null) ?? 'expenses';

  if (view === undefined) return null;
  if (!view || !view.me)
    return (
      <PageContainer>
        <EmptyState
          icon="layers"
          heading="This group is not here"
          description="It may have been deleted, or you are not in it."
        />
      </PageContainer>
    );

  const name = names[groupId];
  const closed = view.group.closedAt !== null;
  const balances = myBalances(view, view.me.id);
  const tabs = [
    { label: 'Expenses', value: 'expenses' },
    ...(views?.balances ? [{ label: 'Balances', value: 'balances' }] : []),
    ...(views?.activity ? [{ label: 'Activity', value: 'activity' }] : []),
  ];
  return (
    <PageContainer>
      <header className={styles.stack}>
        <div className={styles.row}>
          <GroupDot color={view.group.color} />
          <h1 style={{ margin: 0 }}>{name ?? '…'}</h1>
          <AvatarStack
            people={view.members.filter((m) => m.leftAt === null).map((m) => ({ name: m.name }))}
            size="sm"
            label="Members"
          />
          <Link
            href={`/g/${groupId}/settings`}
            aria-label="Group settings"
            title="Group settings"
            style={{ marginLeft: 'auto' }}
          >
            <Icon name="settings" aria-hidden />
          </Link>
        </div>
        {closed ? (
          <p className={styles.muted}>This group is closed. Nothing more can be added to it.</p>
        ) : null}
        <p className={styles.small}>
          {balances.length === 0 ? (
            <Balance amount={0} currency={view.group.defaultCurrency} />
          ) : (
            balances.map((b, i) => (
              <span key={b.currency}>
                {i > 0 ? ' · ' : null}
                <Balance amount={b.amount} currency={b.currency} />
              </span>
            ))
          )}
        </p>
        {closed ? null : (
          <div className={styles.row}>
            <ButtonLink
              renderLink={(props) => <Link {...props} scroll={false} />}
              href={sheetHref(pathname, new URLSearchParams(params.toString()), {
                add: 'expense',
                g: groupId,
              })}
            >
              Add expense
            </ButtonLink>
            {settleUp ? (
              <ButtonLink
                variant="secondary"
                renderLink={(props) => <Link {...props} href={props.href} scroll={false} />}
                href={sheetHref(pathname, new URLSearchParams(params.toString()), {
                  add: 'payment',
                  g: groupId,
                })}
              >
                Settle up
              </ButtonLink>
            ) : null}
          </div>
        )}
        {tabs.length > 1 ? (
          <Tabs
            aria-label="Group views"
            items={tabs}
            value={current}
            onChange={(value) =>
              router.replace(
                sheetHref(pathname, new URLSearchParams(params.toString()), {
                  view: value === 'expenses' ? null : value,
                }),
                { scroll: false },
              )
            }
          />
        ) : null}
      </header>
      {current === 'balances' && views?.balances ? (
        views.balances(view, name)
      ) : current === 'activity' && views?.activity ? (
        views.activity(view, name)
      ) : (
        <ExpensesView view={view} />
      )}
    </PageContainer>
  );
}

type Row =
  | { kind: 'expense'; at: string; created: number; item: LocalExpense }
  | { kind: 'payment'; at: string; created: number; item: LocalPayment };

function ExpensesView({ view }: { view: GroupView }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const search = useRef<HTMLInputElement>(null);
  const pending = useLocal((db) => pendingRows(db), []);
  // The filters are the screen's own state, written whole to the address on every change, so that no keystroke waits for the address and two
  // changes in a row both stand (the router updates the address after a moment).
  const [filters, setFilters] = useState(() => ({
    q: params.get('q') ?? '',
    person: params.get('person') ?? '',
    category: (params.get('category') ?? '') as Category | '',
    deleted: params.get('deleted') === '1',
  }));
  const { q, person, category } = filters;
  const showDeleted = filters.deleted;
  const set = (changes: Partial<typeof filters>) => {
    const next = { ...filters, ...changes };
    setFilters(next);
    router.replace(
      sheetHref(pathname, new URLSearchParams(params.toString()), {
        q: next.q || null,
        person: next.person || null,
        category: next.category || null,
        deleted: next.deleted ? '1' : null,
      }),
      { scroll: false },
    );
  };

  // `/` searches this list, wherever no field has focus (§15.9).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.key !== '/' ||
        (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) ||
        target?.isContentEditable
      )
        return;
      event.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const opened = useOpened([
    ...view.expenses.map((e) => ({
      sealed: e.sealed,
      binding: { group: view.group.id, table: 'expense' as const, row: e.id },
    })),
  ]);
  const textOf = useMemo(() => {
    const out = new Map<string, { description?: string; note?: string }>();
    view.expenses.forEach((e, i) => {
      const t = opened[i];
      out.set(e.id, {
        ...(typeof t?.description === 'string' ? { description: t.description } : {}),
        ...(typeof t?.note === 'string' ? { note: t.note } : {}),
      });
    });
    return out;
  }, [view.expenses, opened]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all: Row[] = [
      ...view.expenses.map((item) => ({
        kind: 'expense' as const,
        at: item.date,
        created: item.createdAt,
        item,
      })),
      ...view.payments.map((item) => ({
        kind: 'payment' as const,
        at: item.date,
        created: item.createdAt,
        item,
      })),
    ];
    return all
      .filter((row) => showDeleted || row.item.deletedAt === null)
      .filter((row) => {
        if (person) {
          const involved =
            row.kind === 'expense'
              ? [...row.item.payers, ...row.item.shares].some((x) => x.memberId === person)
              : row.item.fromMemberId === person || row.item.toMemberId === person;
          if (!involved) return false;
        }
        if (category && (row.kind !== 'expense' || row.item.category !== category)) return false;
        if (needle) {
          if (row.kind !== 'expense') return false;
          const text = textOf.get(row.item.id);
          if (!`${text?.description ?? ''} ${text?.note ?? ''}`.toLowerCase().includes(needle))
            return false;
        }
        return true;
      })
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.created - a.created));
  }, [view, q, person, category, showDeleted, textOf]);

  const months = useMemo(() => {
    const out: { month: string; rows: Row[] }[] = [];
    for (const row of rows) {
      const month = row.at.slice(0, 7);
      const last = out[out.length - 1];
      if (last?.month === month) last.rows.push(row);
      else out.push({ month, rows: [row] });
    }
    return out;
  }, [rows]);

  const nameOf = (memberId: string) =>
    memberId === view.me?.id
      ? 'You'
      : (view.members.find((m) => m.id === memberId)?.name ?? 'Someone');
  const nameLower = (memberId: string) => (memberId === view.me?.id ? 'you' : nameOf(memberId));

  return (
    <section className={styles.stack} aria-label="Expenses">
      <div className={styles.row}>
        <Input
          ref={search}
          type="search"
          aria-label="Search expenses"
          placeholder="Search (/)"
          value={q}
          onChange={(event) => set({ q: event.target.value })}
        />
        <Select
          aria-label="Person"
          value={person}
          onChange={(event) => set({ person: event.target.value })}
        >
          <option value="">Everyone</option>
          {view.members.map((m) => (
            <option key={m.id} value={m.id}>
              {nameOf(m.id)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Category"
          value={category}
          onChange={(event) => set({ category: event.target.value as Category | '' })}
        >
          <option value="">Every category</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_VIEW[c].label}
            </option>
          ))}
        </Select>
        <span className={styles.row}>
          <Toggle
            aria-label="Show deleted"
            checked={showDeleted}
            onChange={(checked) => set({ deleted: checked })}
          />
          <span className={styles.small}>Deleted</span>
        </span>
      </div>
      {months.length === 0 ? (
        <EmptyState
          icon="file-text"
          heading={
            view.expenses.length + view.payments.length === 0
              ? 'No expenses yet'
              : 'Nothing matches'
          }
          description={
            view.expenses.length + view.payments.length === 0
              ? 'Add the first: the amount, a word, Enter.'
              : 'Try fewer filters.'
          }
        />
      ) : (
        months.map(({ month, rows: inMonth }) => (
          <section key={month} aria-label={monthLabel(month)}>
            <h2 className={styles.small}>{monthLabel(month)}</h2>
            <ul className={styles.list} aria-label={`Expenses in ${monthLabel(month)}`}>
              {inMonth.map((row) =>
                row.kind === 'expense' ? (
                  <li
                    key={row.item.id}
                    className={row.item.deletedAt !== null ? styles.closed : undefined}
                  >
                    <Link href={`/g/${view.group.id}/e/${row.item.id}`} className={styles.line}>
                      <Icon
                        name={CATEGORY_VIEW[row.item.category]?.icon ?? 'file-text'}
                        aria-hidden
                      />
                      <span className={styles.lineMain}>
                        <span>{textOf.get(row.item.id)?.description ?? '…'}</span>
                        <span className={styles.small}>
                          {row.item.payers.length === 1
                            ? `${nameOf(row.item.payers[0]?.memberId ?? '')} paid`
                            : `${row.item.payers.length} people paid`}{' '}
                          {formatMoney(toMinor(row.item.amount), row.item.currency)}
                          {row.item.deletedAt !== null ? ' · deleted' : ''}
                        </span>
                      </span>
                      <span className={styles.lineEnd}>
                        <span className={styles.small}>{myPart(row.item, view.me?.id)}</span>
                        <span className={styles.small}>
                          {row.item.date.slice(5)}
                          {pending?.has(`expense:${row.item.id}`) ? (
                            <span title="Not sent yet" aria-label="Not sent yet">
                              {' '}
                              <Icon name="clock" aria-hidden />
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </Link>
                  </li>
                ) : (
                  <li
                    key={row.item.id}
                    className={row.item.deletedAt !== null ? styles.closed : undefined}
                  >
                    <Link href={`/g/${view.group.id}/p/${row.item.id}`} className={styles.line}>
                      <Icon name="arrow-right-left" aria-hidden />
                      <span className={styles.lineMain}>
                        {nameOf(row.item.fromMemberId)} paid {nameLower(row.item.toMemberId)}{' '}
                        {formatMoney(toMinor(row.item.amount), row.item.currency)}
                        {row.item.deletedAt !== null ? ' · deleted' : ''}
                      </span>
                      <span className={styles.lineEnd}>
                        <span className={styles.small}>
                          {row.item.date.slice(5)}
                          {pending?.has(`payment:${row.item.id}`) ? (
                            <span title="Not sent yet" aria-label="Not sent yet">
                              {' '}
                              <Icon name="clock" aria-hidden />
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The reader's part of an expense, in words (§15.5): "you lent €63.00", "you borrowed €21.00", "not involved". */
export function myPart(expense: LocalExpense, memberId: string | undefined): string {
  const paid = expense.payers
    .filter((p) => p.memberId === memberId)
    .reduce((s, p) => s + p.amount, 0);
  const share = expense.shares
    .filter((s) => s.memberId === memberId)
    .reduce((s, x) => s + x.amount, 0);
  if (paid === 0 && share === 0) return 'not involved';
  if (paid > share) return `you lent ${formatMoney(toMinor(paid - share), expense.currency)}`;
  if (share > paid) return `you borrowed ${formatMoney(toMinor(share - paid), expense.currency)}`;
  return 'you paid your share';
}
