'use client';

import { prfExtension, prfSecret } from '../cipher/prf';
import { AccountKeys, httpKeyApi } from './unlock';

/**
 * What a sign-in does with the account's key, in the browser, before the page moves on (DESIGN.md §5.3): **a password or a passkey that signs in
 * also unlocks**, with nothing more to type. A failure here never stops the sign-in: the device is then locked, and the shell offers the other ways
 * (`KeyGate`).
 */
export async function unlockAfterPassword(
  accountId: string,
  unwrap: Uint8Array,
): Promise<'unlocked' | 'locked'> {
  try {
    const keys = await AccountKeys.open(accountId, httpKeyApi);
    try {
      return await keys.afterPassword(unwrap);
    } finally {
      keys.close();
    }
  } catch {
    return 'locked';
  }
}

export async function unlockAfterPasskey(
  accountId: string,
  credentialId: string,
  results: unknown,
): Promise<'unlocked' | 'locked'> {
  try {
    const secret = prfSecret(results);
    if (!secret) return 'locked';
    const keys = await AccountKeys.open(accountId, httpKeyApi);
    try {
      return await keys.afterPasskey(credentialId, secret);
    } finally {
      keys.close();
    }
  } catch {
    return 'locked';
  }
}

/** The PRF extension, for the passkey sign-in to ask for in the same tap. */
export const passkeyExtensions = prfExtension;
