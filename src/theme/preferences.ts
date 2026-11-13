/**
 * What a person chooses about how Tally looks (Settings, Preferences): kept **in this browser** and applied at once, as for every session on the
 * device. It is not the account's, so it is not sent anywhere; without storage a choice lasts until the page is left. `script.ts` applies what is
 * kept before first paint.
 */
export const THEME_KEY = 'tally.theme';

export type ThemeChoice = 'system' | 'light' | 'dark';

export const themeOf = (value: string | null): ThemeChoice =>
  value === 'light' || value === 'dark' ? value : 'system';

function read(storage: Pick<Storage, 'getItem'> | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined,
  key: string,
  value: string | null,
) {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Not kept: it still applies to this page.
  }
}

export const readTheme = (storage?: Pick<Storage, 'getItem'>): ThemeChoice =>
  themeOf(read(storage, THEME_KEY));

/** Choose the theme: kept (`system` is the absence of a choice) and put on the page, following the system's scheme for `system`. */
export function chooseTheme(
  choice: ThemeChoice,
  root: { setAttribute(name: string, value: string): void },
  systemIsDark: boolean,
  storage?: Pick<Storage, 'setItem' | 'removeItem'>,
) {
  write(storage, THEME_KEY, choice === 'system' ? null : choice);
  root.setAttribute('data-theme', choice === 'system' ? (systemIsDark ? 'dark' : 'light') : choice);
}

/**
 * How the sidebar of a wide screen is drawn (DESIGN.md §15.2): **full**, with the places' names, or a **rail** of their icons. Kept in this browser
 * like the theme, and put on the page as `data-sidebar` before first paint by `script.ts`, so that a rail is never drawn full for a moment. A phone
 * has no sidebar, so the choice changes nothing there.
 */
export const SIDEBAR_KEY = 'tally.sidebar';

export type SidebarChoice = 'full' | 'rail';

export const sidebarOf = (value: string | null): SidebarChoice =>
  value === 'rail' ? 'rail' : 'full';

export const readSidebar = (storage?: Pick<Storage, 'getItem'>): SidebarChoice =>
  sidebarOf(read(storage, SIDEBAR_KEY));

/** Choose how the sidebar is drawn: kept (`full` is the absence of a choice) and put on the page at once. */
export function chooseSidebar(
  choice: SidebarChoice,
  root: { setAttribute(name: string, value: string): void },
  storage?: Pick<Storage, 'setItem' | 'removeItem'>,
) {
  write(storage, SIDEBAR_KEY, choice === 'full' ? null : choice);
  root.setAttribute('data-sidebar', choice);
}
