import { type Bytes, concat, fromBase64Url, randomBytes, toBase64Url, utf8 } from './bytes';
import { CipherError } from './errors';
import { AEAD_AES_256_GCM, open as hpkeOpen, seal as hpkeSeal } from './hpke';

/**
 * The two ways a key is wrapped (DESIGN.md §5.3), each to a **binding** that names what is wrapped and for whom, as authenticated data, so that a
 * wrap cannot be passed off as another's: the server, which stores every wrap, cannot hand a person the wrap of another group, epoch or account.
 *
 * - **To a public key** (`h1.`): HPKE's base mode with X25519 and AES-256-GCM (`hpke.ts`). A group key to a member's account key; an account key to
 *   a new device's one-time key.
 * - **To a secret** (`w1.`): AES-256-GCM under a key HKDF derives from the secret (`secret-wrap`): the password's unwrapping value, a passkey's
 *   PRF output, the recovery code, an invitation link's secret. The secret is high-entropy in every case (the password's comes out of Argon2id).
 */
const PUBLIC_VERSION = 'h1';
const SECRET_VERSION = 'w1';
const ENC_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type Binding = readonly (string | number)[];

const bound = (purpose: string, binding: Binding) =>
  utf8(JSON.stringify([`tally/${purpose}/1`, ...binding]));

/** Wraps `secret` to the X25519 public key `recipient`. */
export async function wrapToPublicKey(
  secret: Uint8Array,
  recipient: Uint8Array,
  binding: Binding,
): Promise<string> {
  const info = utf8('tally/wrap/1');
  const { enc, ciphertext } = await hpkeSeal(recipient, info, bound('wrap', binding), secret, {
    aead: AEAD_AES_256_GCM,
  });
  return `${PUBLIC_VERSION}.${toBase64Url(concat(enc, ciphertext))}`;
}

/**
 * Opens a wrap with the recipient's private key. **Only the recipient could have been meant**, so a wrap that does not open is `wrong_key` when it
 * is well formed: the caller holds a key that is not the one it was made for, or the binding is not the one it was made with.
 */
export async function unwrapWithPrivateKey(
  wrapped: string,
  privateKey: CryptoKey,
  publicKey: Uint8Array,
  binding: Binding,
): Promise<Bytes> {
  const [version, body, ...rest] = wrapped.split('.');
  const data = body === undefined ? undefined : fromBase64Url(body);
  if (
    version !== PUBLIC_VERSION ||
    rest.length > 0 ||
    !data ||
    data.length < ENC_BYTES + TAG_BYTES
  ) {
    throw new CipherError('malformed');
  }
  try {
    return await hpkeOpen(
      privateKey,
      publicKey,
      data.slice(0, ENC_BYTES),
      utf8('tally/wrap/1'),
      bound('wrap', binding),
      data.slice(ENC_BYTES),
      AEAD_AES_256_GCM,
    );
  } catch (error) {
    if (error instanceof CipherError && error.kind === 'tampered')
      throw new CipherError('wrong_key');
    throw error;
  }
}

async function secretKey(secret: Uint8Array, purpose: string, use: KeyUsage): Promise<CryptoKey> {
  if (secret.length < 16) throw new CipherError('malformed');
  const material = await crypto.subtle.importKey('raw', concat(secret), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: utf8(`tally/secret-wrap/1/${purpose}`),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [use],
  );
}

/** Wraps `secret` under a key derived from `wrappingSecret` for `purpose` (`password`, `passkey`, `recovery`, `invitation`). */
export async function wrapToSecret(
  secret: Uint8Array,
  wrappingSecret: Uint8Array,
  purpose: string,
  binding: Binding,
): Promise<string> {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: bound(purpose, binding) },
      await secretKey(wrappingSecret, purpose, 'encrypt'),
      concat(secret),
    ),
  );
  return `${SECRET_VERSION}.${toBase64Url(concat(nonce, ciphertext))}`;
}

/** Opens a wrap made by `wrapToSecret`. A well-formed wrap that does not open was made with another secret: `wrong_key`. */
export async function unwrapWithSecret(
  wrapped: string,
  wrappingSecret: Uint8Array,
  purpose: string,
  binding: Binding,
): Promise<Bytes> {
  const [version, body, ...rest] = wrapped.split('.');
  const data = body === undefined ? undefined : fromBase64Url(body);
  if (
    version !== SECRET_VERSION ||
    rest.length > 0 ||
    !data ||
    data.length < NONCE_BYTES + TAG_BYTES
  ) {
    throw new CipherError('malformed');
  }
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: data.slice(0, NONCE_BYTES),
          additionalData: bound(purpose, binding),
        },
        await secretKey(wrappingSecret, purpose, 'decrypt'),
        data.slice(NONCE_BYTES),
      ),
    );
  } catch {
    throw new CipherError('wrong_key');
  }
}
