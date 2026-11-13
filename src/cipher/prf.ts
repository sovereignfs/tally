import { type Bytes, concat, utf8 } from './bytes';
import { CipherError } from './errors';

/**
 * **A passkey that signs in also unlocks** (DESIGN.md §5.3), through WebAuthn's PRF extension: the authenticator gives a secret for an input, and
 * the same passkey always gives the same secret for the same input, which no server ever sees. Tally asks every passkey for one input, a hash of a
 * label, so that its output is a secret of Tally's alone. The output wraps the account key (`wrapToSecret`, purpose `passkey`).
 */
export async function prfInput(): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', utf8('tally/prf/1')));
}

/** WebAuthn's request for the PRF extension, to put in `extensions` of `navigator.credentials.get` or `create`. */
export async function prfExtension(): Promise<{ prf: { eval: { first: Bytes } } }> {
  return { prf: { eval: { first: await prfInput() } } };
}

/** The secret from a credential's `getClientExtensionResults()`, or `undefined` when the passkey has no PRF. */
export function prfSecret(results: unknown): Bytes | undefined {
  const first = (results as { prf?: { results?: { first?: unknown } } } | null)?.prf?.results
    ?.first;
  if (first === undefined) return undefined;
  const view =
    first instanceof ArrayBuffer
      ? new Uint8Array(first)
      : ArrayBuffer.isView(first)
        ? new Uint8Array(first.buffer, first.byteOffset, first.byteLength)
        : undefined;
  if (!view || view.length < 32) throw new CipherError('malformed');
  return concat(view);
}
