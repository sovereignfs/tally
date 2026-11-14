/**
 * Who is signed in on this device, kept **on the device** so that the offline shell can open the groups with no server to ask (DESIGN.md §15.11). It is the
 * account's id, its person's id, the name and the address: what the account menu shows and which store to open. Copied from Tusk's `src/identity.ts`, with
 * the person's id added. It is written by every signed-in page, read only by the
 * shell, and **removed when the person signs out**, as the device's store is. It is never in the service worker's cache, nor in any page
 * the worker keeps: those hold nothing of a person.
 */
export const IDENTITY_KEY = 'tally.me';

export interface Identity {
  /** The account's id. */
  readonly id: string;
  readonly personId: string;
  readonly name: string;
  readonly email: string;
}

/** Reads what a stored value says, or nothing for anything that is not exactly an identity. */
export function parseIdentity(text: string | null): Identity | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return null;
    const { id, personId, name, email } = value as Record<string, unknown>;
    if (
      typeof id !== 'string' ||
      id === '' ||
      typeof personId !== 'string' ||
      personId === '' ||
      typeof name !== 'string' ||
      typeof email !== 'string'
    )
      return null;
    return { id, personId, name, email };
  } catch {
    return null;
  }
}

export function rememberIdentity(identity: Identity): void {
  try {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // Storage that is full or blocked: the shell then has no one to open for, and says to sign in.
  }
}

export function readIdentity(): Identity | null {
  try {
    return parseIdentity(window.localStorage.getItem(IDENTITY_KEY));
  } catch {
    return null;
  }
}

export function forgetIdentity(): void {
  try {
    window.localStorage.removeItem(IDENTITY_KEY);
  } catch {
    // Nothing to remove from.
  }
}
