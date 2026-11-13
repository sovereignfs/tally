import type { ReactNode } from 'react';
import { PhoneNav } from './PhoneNav';
import { SidebarNav } from './SidebarNav';
import { SidebarToggle } from './SidebarToggle';
import styles from './AppShell.module.css';

/**
 * The frame of a signed-in page (DESIGN.md §15.2): a header row, with the sidebar's toggle and the app's wordmark, _tally._, on the left and the bell
 * and the person's avatar menu on the right, and under it the sidebar and the main area on a wide screen, or the main area and the footer on a phone.
 * The two navigations are both drawn and the stylesheet shows one, so the choice is made by the browser's width and no code asks for it
 * (DESIGN.md §15.11).
 *
 * It is made here, and not with the design system's `Header`, because that header always draws a brand badge, an initial on the accent colour, where
 * Tally's has only its wordmark (as Ledger's does). **Worth offering to `@sovereignfs/ui`:** a `Header` whose brand can be the app's own mark.
 *
 * The bell and the avatar menu are given, because what they do (notices, Settings, sign-out) is not this component's (tasks 9.1, 2.1, 2.6).
 */
export function AppShell({
  name,
  bell,
  account,
  nav = true,
  children,
}: {
  /** The app's name, which a screen reader says in place of the wordmark. */
  name: string;
  /** The bell, left of the avatar (task 9.1). */
  bell?: ReactNode;
  /** The person's avatar menu, at the right of the header. */
  account?: ReactNode;
  /** Whether the places are drawn: not on a page that has none, such as the one that is not found for someone who is signed out. */
  nav?: boolean;
  children: ReactNode;
}) {
  return (
    // `sv-app-shell` is where the design system's footer publishes its height (`--sv-shell-footer-height`), so that sheets and dialogs clear it.
    <div id="sv-app-shell" className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.start}>
          {nav ? <SidebarToggle className={styles.toggle} /> : null}
          <a href="/" className={styles.brand} aria-label={name}>
            <span className={styles.wordmark} aria-hidden>
              tally.
            </span>
          </a>
        </div>
        <div className={styles.actions}>
          {bell}
          {account}
        </div>
      </header>
      <div className={styles.body}>
        {nav ? <SidebarNav /> : null}
        <main className={styles.main}>{children}</main>
      </div>
      {nav ? (
        <footer className={styles.footer}>
          <PhoneNav />
        </footer>
      ) : null}
    </div>
  );
}
