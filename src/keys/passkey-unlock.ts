'use client';

import { fromBase64Url } from '../cipher/bytes';
import { prfExtension, prfSecret } from '../cipher/prf';
import { AccountKeys, httpKeyApi } from './unlock';

/**
 * **A passkey that unlocks, as well as signs in** (DESIGN.md §5.3). When a passkey is added in Settings, the browser is asked once for that passkey's
 * PRF output (one more touch of the fingerprint or the key), and the account's key is wrapped to it, so the passkey alone unlocks the next device. The
 * request needs no server: its challenge is random, and nothing it returns but the PRF output is used, which stays here. A passkey without PRF still
 * signs in, and says so.
 */
export async function wrapForPasskey(
  accountId: string,
  credentialId: string,
): Promise<'unlocks' | 'no-prf' | 'locked'> {
  const id = fromBase64Url(credentialId);
  if (!id) return 'no-prf';
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: window.location.hostname,
      allowCredentials: [{ type: 'public-key', id }],
      userVerification: 'preferred',
      // TypeScript's DOM types do not know the PRF extension yet, which every current browser takes (WebAuthn Level 3).
      extensions: (await prfExtension()) as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) return 'no-prf';
  const secret = prfSecret(assertion.getClientExtensionResults());
  if (!secret) return 'no-prf';
  const keys = await AccountKeys.open(accountId, httpKeyApi);
  try {
    return (await keys.afterPasskey(assertion.id, secret)) === 'unlocked' ? 'unlocks' : 'locked';
  } finally {
    keys.close();
  }
}

/** The wrap made from the PRF output an authenticator gave as the passkey was made, where it gives one: no second touch. */
export async function wrapFromRegistration(
  accountId: string,
  credentialId: string,
  results: unknown,
): Promise<'unlocks' | 'no-prf' | 'locked'> {
  const secret = prfSecret(results);
  if (!secret) return 'no-prf';
  const keys = await AccountKeys.open(accountId, httpKeyApi);
  try {
    return (await keys.afterPasskey(credentialId, secret)) === 'unlocked' ? 'unlocks' : 'locked';
  } finally {
    keys.close();
  }
}

/** Removes the wrap of a passkey that was removed: it signs in nowhere now, and unlocks nothing. */
export async function forgetPasskey(credentialId: string): Promise<void> {
  const keys = await httpKeyApi.get();
  const wrap = keys.wraps.find((w) => w.method === 'passkey' && w.credentialId === credentialId);
  if (wrap) await fetch(`/api/keys/wraps/${encodeURIComponent(wrap.id)}`, { method: 'DELETE' });
}
