'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@sovereignfs/ui';
import { SIDEBAR_PLACES, placeById, placeOf } from './nav';
import styles from './AppShell.module.css';

/**
 * The sidebar of a wide screen (DESIGN.md §15.2): **Add expense** first, always one click away; Home, People, Activity and Insights; then **Groups**,
 * with _New group_ last. Full, or a rail of icons (the header's toggle, `data-sidebar` on the page): a rail shows each row by its icon, with its name
 * as the label and the tooltip. Its rows are the app's own, as Tusk's are, since the design system's `NavList` has no rail.
 *
 * Add expense and New group are drawn disabled until the add sheet (7.2) and the new-group dialog (7.1) exist, and the groups themselves arrive with the
 * device's store (7.1), so that the frame is the one the design describes.
 */
export function SidebarNav() {
  const current = placeOf(usePathname())?.id;
  return (
    <nav className={styles.sidebar} aria-label="Main">
      <button
        type="button"
        className={`${styles.row} ${styles.add}`}
        disabled
        aria-label="Add expense"
        title="Adding an expense arrives with the add sheet"
      >
        <Icon name="plus" aria-hidden />
        <span className={styles.label}>Add expense</span>
      </button>
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
        <button
          type="button"
          className={`${styles.row} ${styles.quiet}`}
          disabled
          aria-label="New group"
          title="Making a group arrives with the groups list"
        >
          <Icon name="folder-plus" aria-hidden />
          <span className={styles.label}>New group</span>
        </button>
      </section>
    </nav>
  );
}
