'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AvatarStack, Button, EmptyState } from '@sovereignfs/ui';
import { Balance, GroupDot } from './Balance';
import { myBalances } from './data';
import { NewGroupDialog } from './NewGroupDialog';
import { useGroupNames } from './hooks';
import { useGroupViews } from './useGroups';
import styles from './Screens.module.css';

/**
 * `/groups` (DESIGN.md §15.3): every group the person is in, open ones by latest activity and closed ones after, dimmed, as tiles at every width: the
 * dot and name, the members, and the person's balance in each currency. Read from the device, so it paints offline. _New group_ is here too.
 */
export function GroupsList() {
  const views = useGroupViews();
  const names = useGroupNames(views?.map((v) => v.group) ?? []);
  const [making, setMaking] = useState(false);
  if (!views) return null;
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <Button onClick={() => setMaking(true)}>New group</Button>
      </div>
      {views.length === 0 ? (
        <EmptyState
          icon="layers"
          heading="Create your first group"
          description="A trip, a flat, a dinner: whoever you share costs with."
        />
      ) : (
        <ul className={styles.tiles} aria-label="Your groups">
          {views.map((view) => {
            const balances = myBalances(view, view.me?.id);
            const name = names[view.group.id];
            return (
              <li key={view.group.id}>
                <Link
                  href={`/g/${view.group.id}`}
                  className={`${styles.tile} ${view.group.closedAt !== null ? styles.closed : ''}`}
                >
                  <span className={styles.tileHead}>
                    <GroupDot color={view.group.color} />
                    {name ?? '…'}
                  </span>
                  <AvatarStack
                    people={view.members
                      .filter((m) => m.leftAt === null)
                      .map((m) => ({ name: m.name }))}
                    size="sm"
                    label="Members"
                  />
                  <span className={styles.small}>
                    {view.group.closedAt !== null ? (
                      <span className={styles.muted}>Closed</span>
                    ) : balances.length === 0 ? (
                      <Balance amount={0} currency={view.group.defaultCurrency} />
                    ) : (
                      balances.map((b, i) => (
                        <span key={b.currency}>
                          {i > 0 ? ' · ' : null}
                          <Balance amount={b.amount} currency={b.currency} />
                        </span>
                      ))
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <NewGroupDialog open={making} onClose={() => setMaking(false)} />
    </div>
  );
}
