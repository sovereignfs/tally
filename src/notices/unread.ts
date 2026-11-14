/**
 * **The last unread count, kept on the device** (DESIGN.md §12.2), so that the bell shows it offline as last synced. One number per account in
 * `localStorage`, nothing of what the notices say; forgotten at sign-out with the rest of the device's store (`src/sync/device.ts`). Storage that is
 * not there (a private window, blocked site data) only means the bell starts at nothing.
 */
const key = (accountId: string) => `tally.unread.${accountId}`;

export function rememberedUnread(accountId: string): number {
  try {
    const value = Number(localStorage.getItem(key(accountId)));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function rememberUnread(accountId: string, count: number): void {
  try {
    localStorage.setItem(key(accountId), String(count));
  } catch {
    // Kept only as a convenience.
  }
}

export function forgetUnread(accountId: string): void {
  try {
    localStorage.removeItem(key(accountId));
  } catch {
    // Nothing kept.
  }
}
