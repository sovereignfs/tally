'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ButtonLink, EmptyState } from '@sovereignfs/ui';
import { toMinor } from '../money/amount';
import { formatMoney } from '../money/text';
import { LocalLink, sheetHref } from './AddSheet';
import type { GroupView } from './data';
import { RemindButton } from './RemindButton';
import styles from './Screens.module.css';

/**
 * A group's **Balances** (DESIGN.md §15.5, §10): each member's balance per currency, then who owes whom by the group's setting (pairwise, or simplified),
 * each pair that involves the reader with **Settle up**, which opens the payment sheet filled in (§9), and a line saying whether debts are simplified,
 * with an owner's link to change it, and Remind beside someone who owes the reader (§12.4). Read from the device.
 */
export function BalancesView({ view }: { view: GroupView }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const nameOf = (id: string) =>
    id === view.me?.id ? 'You' : (view.members.find((m) => m.id === id)?.name ?? 'Someone');
  const objectOf = (id: string) => (id === view.me?.id ? 'you' : nameOf(id));
  const currencies = [...view.balances.keys()];
  const closed = view.group.closedAt !== null;

  return (
    <section className={styles.stack} aria-label="Balances">
      {currencies.length === 0 ? (
        <EmptyState
          icon="circle-check"
          heading="Everyone is settled up"
          description="Nothing has been spent here yet, or it all evens out."
        />
      ) : (
        <ul className={styles.list} aria-label="Each member’s balance">
          {view.members.map((member) => {
            const amounts = currencies
              .map((currency) => ({
                currency,
                amount: view.balances.get(currency)?.get(member.id) ?? 0,
              }))
              .filter((b) => b.amount !== 0);
            return (
              <li key={member.id} className={styles.line}>
                <span className={styles.lineMain}>
                  {nameOf(member.id)}
                  {member.leftAt !== null ? <span className={styles.small}> (left)</span> : null}
                </span>
                <span className={styles.lineEnd}>
                  {amounts.length === 0 ? (
                    <span className={styles.settled}>settled up</span>
                  ) : (
                    amounts.map((b) => (
                      <span key={b.currency} className={b.amount > 0 ? styles.owed : styles.owe}>
                        {member.id === view.me?.id
                          ? b.amount > 0
                            ? `you are owed ${formatMoney(toMinor(b.amount), b.currency)}`
                            : `you owe ${formatMoney(toMinor(-b.amount), b.currency)}`
                          : b.amount > 0
                            ? `is owed ${formatMoney(toMinor(b.amount), b.currency)}`
                            : `owes ${formatMoney(toMinor(-b.amount), b.currency)}`}
                      </span>
                    ))
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className={styles.small}>Who owes whom</h2>
      <p className={styles.small}>
        {view.group.simplifyDebts
          ? 'Debts are simplified: the fewest payments that settle everyone, which can name two people who never shared a bill.'
          : 'Each pair is what the two of them shared.'}{' '}
        {view.me?.role === 'owner' ? (
          <Link href={`/g/${view.group.id}/settings`}>Change this</Link>
        ) : null}
      </p>
      {view.suggestions.length === 0 ? (
        <p className={styles.muted}>Nobody owes anybody.</p>
      ) : (
        <ul className={styles.list} aria-label="Who owes whom">
          {view.suggestions.map((debt) => {
            const mine = debt.fromId === view.me?.id || debt.toId === view.me?.id;
            const words = `${nameOf(debt.fromId)} ${debt.fromId === view.me?.id ? 'owe' : 'owes'} ${objectOf(debt.toId)} ${formatMoney(debt.amount, debt.currency)}`;
            return (
              <li key={`${debt.currency}:${debt.fromId}:${debt.toId}`} className={styles.line}>
                <span className={styles.lineMain}>{words}</span>
                {mine && !closed ? (
                  <ButtonLink
                    variant="secondary"
                    size="sm"
                    aria-label={`Settle up: ${words}`}
                    renderLink={(props) => <LocalLink {...props} href={props.href} />}
                    href={sheetHref(pathname, new URLSearchParams(params.toString()), {
                      add: 'payment',
                      g: view.group.id,
                      from: debt.fromId,
                      to: debt.toId,
                      amount: String(debt.amount),
                      currency: debt.currency,
                    })}
                  >
                    Settle up
                  </ButtonLink>
                ) : null}
                {debt.toId === view.me?.id && !closed ? (
                  <RemindButton
                    name={nameOf(debt.fromId)}
                    targets={[{ groupId: view.group.id, memberId: debt.fromId }]}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
