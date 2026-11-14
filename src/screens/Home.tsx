'use client';

import { RemindButton, owingGroups } from './RemindButton';
import Link from 'next/link';
import { useState } from 'react';
import { AvatarStack, Button, EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';
import { betweenTwo, position } from '../balances/across';
import { formatMoney } from '../money/text';
import { toMinor } from '../money/amount';
import { useMe } from '../sync/react';
import { Balance, GroupDot } from './Balance';
import { myBalances, peopleOf, sharedGroups } from './data';
import { myPart } from './GroupScreen';
import { useGroupNames, useOpened } from './hooks';
import { NewGroupDialog } from './NewGroupDialog';
import { BetweenWords, totalsWith } from './People';
import { SettleWithPerson } from './SettleWithPerson';
import { useGroupViews } from './useGroups';
import styles from './Screens.module.css';

/**
 * **Home** (DESIGN.md §15.4): where the reader stands, then what to do about it. Their balance per currency (owed and owing, the primary currency first);
 * To settle, everyone with a balance against them, largest first, with the groups it comes from and Settle up (with a person, §9); the open groups with a
 * balance; and the last ten expenses and payments involving them. A person with no group sees one empty state. Remind sits beside whoever owes the reader (§12.4). From the device.
 */
export function Home() {
  const me = useMe();
  const views = useGroupViews();
  const names = useGroupNames(views?.map((v) => v.group) ?? []);
  const [making, setMaking] = useState(false);

  const recent = (views ?? [])
    .flatMap((view) => [
      ...view.expenses
        .filter(
          (e) =>
            e.deletedAt === null &&
            view.me &&
            [...e.payers, ...e.shares].some((x) => x.memberId === view.me?.id),
        )
        .map((e) => ({ kind: 'expense' as const, view, item: e })),
      ...view.payments
        .filter(
          (p) =>
            p.deletedAt === null && view.me && [p.fromMemberId, p.toMemberId].includes(view.me.id),
        )
        .map((p) => ({ kind: 'payment' as const, view, item: p })),
    ])
    .sort((a, b) =>
      a.item.date < b.item.date
        ? 1
        : a.item.date > b.item.date
          ? -1
          : b.item.createdAt - a.item.createdAt,
    )
    .slice(0, 10);
  const texts = useOpened(
    recent.map((r) => ({
      sealed: r.kind === 'expense' ? r.item.sealed : null,
      binding: { group: r.view.group.id, table: 'expense' as const, row: r.item.id },
    })),
  );

  if (!views) return null;
  if (views.length === 0)
    return (
      <PageContainer>
        <PageHeader title="Home" description="Where you stand, and what to do about it." />
        <EmptyState
          icon="layers"
          heading="Create your first group"
          description="A trip, a flat, a dinner: whoever you share costs with."
          action={<Button onClick={() => setMaking(true)}>New group</Button>}
        />
        <NewGroupDialog open={making} onClose={() => setMaking(false)} />
      </PageContainer>
    );

  const mine = views.filter((v) => v.me && v.me.leftAt === null);
  const standing = position(
    mine.map((v) => ({ balances: v.balances, me: v.me?.id ?? '' })),
    me?.primaryCurrency ?? 'EUR',
  );
  const toSettle = peopleOf(views, me?.personId ?? '')
    .map((person) => ({
      person,
      totals: totalsWith(person),
      between: betweenTwo(sharedGroups(person)),
    }))
    .filter((p) => p.totals.length > 0)
    .sort(
      (a, b) =>
        Math.max(...b.totals.map((t) => Math.abs(t.amount))) -
        Math.max(...a.totals.map((t) => Math.abs(t.amount))),
    );
  const withBalance = mine.filter(
    (v) => v.group.closedAt === null && myBalances(v, v.me?.id).length > 0,
  );
  const nameOf = (view: (typeof views)[number], memberId: string) =>
    memberId === view.me?.id
      ? 'You'
      : (view.members.find((m) => m.id === memberId)?.name ?? 'Someone');

  return (
    <PageContainer>
      <PageHeader title="Home" description="Where you stand, and what to do about it." />
      <section className={styles.stack} aria-label="Your balance">
        {standing.length === 0 ? (
          <p className={styles.settled}>You are settled up everywhere.</p>
        ) : (
          <ul className={styles.list}>
            {standing.map((p) => (
              <li key={p.currency} className={styles.line}>
                <span className={styles.lineMain}>{p.currency}</span>
                <span className={styles.lineEnd}>
                  {p.owed > 0 ? (
                    <span className={styles.owed}>
                      You are owed {formatMoney(p.owed, p.currency)}
                    </span>
                  ) : null}
                  {p.owing > 0 ? (
                    <span className={styles.owe}>You owe {formatMoney(p.owing, p.currency)}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {toSettle.length > 0 ? (
        <section className={styles.stack} aria-label="To settle">
          <h2 className={styles.small}>To settle</h2>
          <ul className={styles.list}>
            {toSettle.map(({ person, totals, between }) => (
              <li key={person.personId} className={styles.line}>
                <span className={styles.lineMain}>
                  <Link href={`/people/${person.personId}`}>{person.name}</Link>
                  <span className={styles.small}>
                    <BetweenWords name={person.name} totals={totals} />
                    {' · '}
                    {[...new Set(between.map((b) => names[b.groupId] ?? '…'))].join(', ')}
                  </span>
                </span>
                <RemindButton name={person.name} targets={owingGroups(person)} />
                <SettleWithPerson person={person} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {withBalance.length > 0 ? (
        <section className={styles.stack} aria-label="Groups with a balance">
          <h2 className={styles.small}>Groups</h2>
          <ul className={styles.tiles}>
            {withBalance.map((view) => (
              <li key={view.group.id}>
                <Link href={`/g/${view.group.id}`} className={styles.tile}>
                  <span className={styles.tileHead}>
                    <GroupDot color={view.group.color} />
                    {names[view.group.id] ?? '…'}
                  </span>
                  <AvatarStack
                    people={view.members
                      .filter((m) => m.leftAt === null)
                      .map((m) => ({ name: m.name }))}
                    size="sm"
                    label="Members"
                  />
                  <span className={styles.small}>
                    {myBalances(view, view.me?.id).map((b, i) => (
                      <span key={b.currency}>
                        {i > 0 ? ' · ' : null}
                        <Balance amount={b.amount} currency={b.currency} />
                      </span>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section className={styles.stack} aria-label="Recently">
          <h2 className={styles.small}>Recently</h2>
          <ul className={styles.list}>
            {recent.map((r, i) => (
              <li key={r.item.id}>
                <Link
                  href={`/g/${r.view.group.id}/${r.kind === 'expense' ? 'e' : 'p'}/${r.item.id}`}
                  className={styles.line}
                >
                  <span className={styles.lineMain}>
                    <span>
                      {r.kind === 'expense'
                        ? typeof texts[i]?.description === 'string'
                          ? texts[i]?.description
                          : '…'
                        : `${nameOf(r.view, r.item.fromMemberId)} paid ${nameOf(r.view, r.item.toMemberId).replace(/^You$/, 'you')}`}
                    </span>
                    <span className={styles.small}>
                      {names[r.view.group.id] ?? '…'} · {r.item.date}
                    </span>
                  </span>
                  <span className={`${styles.lineEnd} ${styles.small}`}>
                    {r.kind === 'expense'
                      ? myPart(r.item, r.view.me?.id)
                      : formatMoney(toMinor(r.item.amount), r.item.currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PageContainer>
  );
}
