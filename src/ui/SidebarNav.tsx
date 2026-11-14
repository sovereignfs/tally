'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { sheetHref } from '../screens/AddSheet';
import { useState } from 'react';
import { Icon } from '@sovereignfs/ui';
import { GroupDot } from '../screens/Balance';
import { myBalances } from '../screens/data';
import { useGroupNames } from '../screens/hooks';
import { NewGroupDialog } from '../screens/NewGroupDialog';
import { useGroupViews } from '../screens/useGroups';
import { toMinor } from '../money/amount';
import { formatMoney } from '../money/text';
import { SIDEBAR_PLACES, placeById, placeOf } from './nav';
import styles from './AppShell.module.css';

/**
 * The sidebar of a wide screen (DESIGN.md §15.2): **Add expense** first, always one click away; Home, People, Activity and Insights; then **Groups**,
 * with _New group_ last. Full, or a rail of icons (the header's toggle, `data-sidebar` on the page): a rail shows each row by its icon, with its name
 * as the label and the tooltip. Its rows are the app's own, as Tusk's are, since the design system's `NavList` has no rail.
 *
 * The groups are read from the device's store: open ones by latest activity, with the dot and the person's balance in it, closed ones after, dimmed.
 * Add expense opens the add sheet over the page (`?add=expense`).
 */
export function SidebarNav() {
  const pathname = usePathname();
  const current = placeOf(pathname)?.id;
  const [making, setMaking] = useState(false);
  const params = useSearchParams();
  // Opened over the page, with this page's group filled in when it is one (§15.9).
  const inGroup = /^\/g\/([^/]+)/.exec(pathname)?.[1];
  const addHref = sheetHref(pathname, new URLSearchParams(params.toString()), {
    add: 'expense',
    ...(inGroup ? { g: inGroup } : {}),
  });
  return (
    <nav className={styles.sidebar} aria-label="Main">
      <Link
        href={addHref}
        scroll={false}
        className={`${styles.row} ${styles.add}`}
        aria-label="Add expense"
        title="Add expense (N)"
      >
        <Icon name="plus" aria-hidden />
        <span className={styles.label}>Add expense</span>
      </Link>
      <ul className={styles.list}>
        {SIDEBAR_PLACES.map((id) => {
          const place = placeById(id);
          return (
            <li key={id}>
              <Link
                href={place.href}
                className={styles.row}
                aria-current={current === id ? 'page' : undefined}
                aria-label={place.label}
                title={place.label}
              >
                <Icon name={place.icon} aria-hidden />
                <span className={styles.label}>{place.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <section className={styles.groups} aria-label="Groups">
        <Link
          href="/groups"
          className={styles.heading}
          aria-current={current === 'groups' ? 'page' : undefined}
          title="Groups"
        >
          <Icon name="layers" aria-hidden className={styles.headingIcon} />
          <span className={styles.label}>Groups</span>
        </Link>
        <SidebarGroups />
        <button
          type="button"
          className={`${styles.row} ${styles.quiet}`}
          aria-label="New group"
          title="New group"
          onClick={() => setMaking(true)}
        >
          <Icon name="folder-plus" aria-hidden />
          <span className={styles.label}>New group</span>
        </button>
        <NewGroupDialog open={making} onClose={() => setMaking(false)} />
      </section>
    </nav>
  );
}

/** The sidebar's groups (DESIGN.md §15.2): each a link with its dot, its name and the person's balance in it, in short. */
function SidebarGroups() {
  const views = useGroupViews();
  const names = useGroupNames(views?.map((v) => v.group) ?? []);
  const pathname = usePathname();
  if (!views || views.length === 0) return null;
  return (
    <ul className={styles.list}>
      {views.map((view) => {
        const [first] = myBalances(view, view.me?.id);
        const name = names[view.group.id] ?? '…';
        const short =
          view.group.closedAt !== null
            ? 'closed'
            : first
              ? `${first.amount > 0 ? 'owed' : 'owe'} ${formatMoney(toMinor(Math.abs(first.amount)), first.currency)}`
              : '';
        return (
          <li key={view.group.id} className={view.group.closedAt !== null ? styles.dim : undefined}>
            <Link
              href={`/g/${view.group.id}`}
              className={styles.row}
              aria-current={pathname.startsWith(`/g/${view.group.id}`) ? 'page' : undefined}
              aria-label={short ? `${name}, ${short}` : name}
              title={name}
            >
              <GroupDot color={view.group.color} />
              <span className={styles.label}>{name}</span>
              {short ? <span className={`${styles.label} ${styles.trailing}`}>{short}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
