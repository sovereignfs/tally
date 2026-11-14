'use client';

import { RemindButton, owingGroups } from './RemindButton';
import Link from 'next/link';
import { Avatar, EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';
import { betweenTwo, totalBetween } from '../balances/across';
import { toMinor } from '../money/amount';
import { formatMoney } from '../money/text';
import { useMe } from '../sync/react';
import { Balance, GroupDot } from './Balance';
import { type PersonView, peopleOf, sharedGroups } from './data';
import { myPart } from './GroupScreen';
import { useGroupNames, useOpened } from './hooks';
import { SettleWithPerson } from './SettleWithPerson';
import { useGroupViews } from './useGroups';
import styles from './Screens.module.css';

/** What lies between the reader and a person, per currency, from the device: positive, they owe the reader. */
export function totalsWith(person: PersonView): { currency: string; amount: number }[] {
  return [...totalBetween(betweenTwo(sharedGroups(person)))]
    .filter(([, amount]) => amount !== 0)
    .map(([currency, amount]) => ({ currency, amount }));
}

/** The words for what lies between: "Sam owes you €12.00", "you owe Sam ¥300". */
export function BetweenWords({
  name,
  totals,
}: {
  name: string;
  totals: { currency: string; amount: number }[];
}) {
  if (totals.length === 0) return <span className={styles.settled}>settled up</span>;
  return (
    <>
      {totals.map((t, i) => (
        <span key={t.currency}>
          {i > 0 ? ' · ' : null}
          {/* The balance is the person's: positive is owed to them, so the reader's figure is turned round. */}
          <Balance amount={-t.amount} currency={t.currency} who={{ name }} />
        </span>
      ))}
    </>
  );
}

/** `/people` (DESIGN.md §15.3): everyone the reader shares a group with, those with a balance first (largest), then by name. Read from the device. */
export function PeopleList() {
  const me = useMe();
  const views = useGroupViews();
  if (!views) return null;
  const people = peopleOf(views, me?.personId ?? '')
    .map((person) => ({ person, totals: totalsWith(person) }))
    .sort(
      (a, b) =>
        Math.max(0, ...b.totals.map((t) => Math.abs(t.amount))) -
          Math.max(0, ...a.totals.map((t) => Math.abs(t.amount))) ||
        a.person.name.localeCompare(b.person.name),
    );
  return (
    <PageContainer>
      <PageHeader title="People" description="Everyone you share a group with." />
      {people.length === 0 ? (
        <EmptyState
          icon="users"
          heading="Nobody yet"
          description="The people of your groups show here."
        />
      ) : (
        <ul className={styles.list} aria-label="People">
          {people.map(({ person, totals }) => (
            <li key={person.personId}>
              <Link href={`/people/${person.personId}`} className={styles.line}>
                <Avatar name={person.name} size="sm" />
                <span className={styles.lineMain}>
                  {person.name}
                  {person.placeholder ? (
                    <span className={styles.small}>not on Tally yet</span>
                  ) : null}
                  {person.leftTally ? <span className={styles.small}>left Tally</span> : null}
                </span>
                <span className={`${styles.lineEnd} ${styles.small}`}>
                  <BetweenWords name={person.name} totals={totals} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}

/**
 * **A person** (DESIGN.md §15.7): the name and initials, "not on Tally yet" for a placeholder, what lies between the two per currency and by group,
 * Settle up with them (one payment per group and currency), and the expenses and payments both took part in, newest first, each with its group.
 * Remind, in every group where they owe the reader (§12.4).
 */
export function PersonScreen({ personId }: { personId: string }) {
  const me = useMe();
  const views = useGroupViews();
  const person = views
    ? peopleOf(views, me?.personId ?? '').find((p) => p.personId === personId)
    : undefined;
  const names = useGroupNames(person?.groups.map((g) => g.view.group) ?? []);
  const shared = person
    ? person.groups.flatMap((g) => [
        ...g.view.expenses
          .filter(
            (e) =>
              e.deletedAt === null &&
              [...e.payers, ...e.shares].some((x) => x.memberId === g.them) &&
              [...e.payers, ...e.shares].some((x) => x.memberId === g.me),
          )
          .map((e) => ({ kind: 'expense' as const, g, item: e })),
        ...g.view.payments
          .filter(
            (p) =>
              p.deletedAt === null &&
              [p.fromMemberId, p.toMemberId].includes(g.them) &&
              [p.fromMemberId, p.toMemberId].includes(g.me),
          )
          .map((p) => ({ kind: 'payment' as const, g, item: p })),
      ])
    : [];
  shared.sort((a, b) =>
    a.item.date < b.item.date
      ? 1
      : a.item.date > b.item.date
        ? -1
        : b.item.createdAt - a.item.createdAt,
  );
  const texts = useOpened(
    shared.map((r) => ({
      sealed: r.kind === 'expense' ? r.item.sealed : null,
      binding: { group: r.g.view.group.id, table: 'expense' as const, row: r.item.id },
    })),
  );

  if (!views) return null;
  if (!person)
    return (
      <PageContainer>
        <EmptyState
          icon="user"
          heading="Nobody here"
          description="You share no group with this person, or not on this device yet."
        />
      </PageContainer>
    );
  const between = betweenTwo(sharedGroups(person));
  const totals = totalsWith(person);
  return (
    <PageContainer>
      <article className={styles.stack} aria-label={person.name}>
        <div className={styles.row}>
          <Avatar name={person.name} size="lg" />
          <h1 style={{ margin: 0 }}>{person.name}</h1>
          {person.placeholder ? <span className={styles.muted}>not on Tally yet</span> : null}
        </div>
        <p>
          <BetweenWords name={person.name} totals={totals} />
        </p>
        <div className={styles.row}>
          <SettleWithPerson person={person} />
          <RemindButton name={person.name} targets={owingGroups(person)} />
        </div>
        {between.length > 0 ? (
          <section aria-label="By group" className={styles.stack}>
            <h2 className={styles.small}>By group</h2>
            <ul className={styles.list}>
              {between.map((b) => {
                const g = person.groups.find((x) => x.view.group.id === b.groupId);
                return (
                  <li key={`${b.groupId}:${b.currency}`} className={styles.line}>
                    {g ? <GroupDot color={g.view.group.color} /> : null}
                    <span className={styles.lineMain}>{names[b.groupId] ?? '…'}</span>
                    <span className={styles.lineEnd}>
                      <Balance
                        amount={-b.amount}
                        currency={b.currency}
                        who={{ name: person.name }}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        <section aria-label="Together" className={styles.stack}>
          <h2 className={styles.small}>Together</h2>
          {shared.length === 0 ? <p className={styles.muted}>Nothing shared yet.</p> : null}
          <ul className={styles.list}>
            {shared.map((r, i) => (
              <li key={r.item.id}>
                <Link
                  href={`/g/${r.g.view.group.id}/${r.kind === 'expense' ? 'e' : 'p'}/${r.item.id}`}
                  className={styles.line}
                >
                  <span className={styles.lineMain}>
                    <span>
                      {r.kind === 'expense'
                        ? typeof texts[i]?.description === 'string'
                          ? texts[i]?.description
                          : '…'
                        : `${r.item.fromMemberId === r.g.me ? 'You' : person.name} paid ${r.item.toMemberId === r.g.me ? 'you' : person.name}`}
                    </span>
                    <span className={styles.small}>
                      {names[r.g.view.group.id] ?? '…'} · {r.item.date}
                    </span>
                  </span>
                  <span className={`${styles.lineEnd} ${styles.small}`}>
                    {r.kind === 'expense'
                      ? myPart(r.item, r.g.me)
                      : formatMoney(toMinor(r.item.amount), r.item.currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </article>
    </PageContainer>
  );
}
