import { type Bytes, bytes, concat, i2osp, utf8 } from './bytes';
import { CipherError } from './errors';

/**
 * HPKE's base mode (RFC 9180), single-shot, for wrapping a key to a public key (DESIGN.md §5.3): **DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, and
 * AES-256-GCM** for Tally's wraps; AES-128-GCM is here only so that both of the RFC's X25519 vectors can be checked (`hpke.test.ts`). Every
 * primitive is WebCrypto's: X25519, HMAC-SHA-256 (from which HKDF's Extract and Expand are built, since WebCrypto's HKDF does them as one step and
 * HPKE labels each) and AES-GCM. Nothing here holds state: `seal` makes a fresh ephemeral key each time, and `open` needs only the recipient's key.
 */
export const KEM_X25519_HKDF_SHA256 = 0x0020;
export const KDF_HKDF_SHA256 = 0x0001;
export const AEAD_AES_128_GCM = 0x0001;
export const AEAD_AES_256_GCM = 0x0002;

export type Aead = typeof AEAD_AES_128_GCM | typeof AEAD_AES_256_GCM;

const N_SECRET = 32;
const N_ENC = 32;
const N_NONCE = 12;
const keyLength = (aead: Aead) => (aead === AEAD_AES_256_GCM ? 32 : 16);

const KEM_SUITE = concat(utf8('KEM'), i2osp(KEM_X25519_HKDF_SHA256, 2));
const hpkeSuite = (aead: Aead) =>
  concat(utf8('HPKE'), i2osp(KEM_X25519_HKDF_SHA256, 2), i2osp(KDF_HKDF_SHA256, 2), i2osp(aead, 2));

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Bytes> {
  const material = await crypto.subtle.importKey(
    'raw',
    key.length === 0 ? bytes(32) : concat(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', material, concat(data)));
}

/** HKDF-Extract: an empty salt is 32 zero bytes, as RFC 5869 says. */
const extract = (salt: Uint8Array, ikm: Uint8Array) => hmac(salt, ikm);

async function expand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Bytes> {
  const out = bytes(length);
  let previous: Uint8Array = bytes(0);
  for (let counter = 1, at = 0; at < length; counter++) {
    previous = await hmac(prk, concat(previous, info, i2osp(counter, 1)));
    out.set(previous.slice(0, length - at), at);
    at += previous.length;
  }
  return out;
}

const labeledExtract = (suite: Uint8Array, salt: Uint8Array, label: string, ikm: Uint8Array) =>
  extract(salt, concat(utf8('HPKE-v1'), suite, utf8(label), ikm));

const labeledExpand = (
  suite: Uint8Array,
  prk: Uint8Array,
  label: string,
  info: Uint8Array,
  length: number,
) => expand(prk, concat(i2osp(length, 2), utf8('HPKE-v1'), suite, utf8(label), info), length);

/** An X25519 key pair as WebCrypto keys, the private one usable for `deriveBits`. */
export interface X25519KeyPair {
  privateKey: CryptoKey;
  publicKey: Bytes;
}

export async function generateX25519(extractable = false): Promise<X25519KeyPair> {
  const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, extractable, [
    'deriveBits',
  ])) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
  };
}

const toB64u = (data: Uint8Array) =>
  btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** An X25519 private key from its 32 bytes and its public key's, as JWK, the one form WebCrypto imports a raw private key from. */
export async function importX25519Private(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  extractable = false,
): Promise<CryptoKey> {
  if (privateKey.length !== 32 || publicKey.length !== 32) throw new CipherError('malformed');
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'X25519', d: toB64u(privateKey), x: toB64u(publicKey) },
    { name: 'X25519' },
    extractable,
    ['deriveBits'],
  );
}

/** The 32 bytes of an extractable X25519 private key. */
export async function exportX25519Private(privateKey: CryptoKey): Promise<Bytes> {
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  const d = jwk.d ?? '';
  const binary = atob(d.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)) as Bytes;
}

async function dh(privateKey: CryptoKey, publicKey: Uint8Array): Promise<Bytes> {
  if (publicKey.length !== 32) throw new CipherError('malformed');
  let peer: CryptoKey;
  try {
    peer = await crypto.subtle.importKey('raw', concat(publicKey), { name: 'X25519' }, true, []);
  } catch {
    throw new CipherError('malformed');
  }
  try {
    return new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'X25519', public: peer }, privateKey, 256),
    );
  } catch {
    // A low-order public key gives the all-zero secret, which X25519 refuses to derive: never a valid recipient.
    throw new CipherError('malformed');
  }
}

async function kemSharedSecret(dhSecret: Uint8Array, enc: Uint8Array, pkR: Uint8Array) {
  const eaePrk = await labeledExtract(KEM_SUITE, bytes(0), 'eae_prk', dhSecret);
  return labeledExpand(KEM_SUITE, eaePrk, 'shared_secret', concat(enc, pkR), N_SECRET);
}

/** HPKE's key schedule for the base mode: the AEAD key and the base nonce. */
export async function keySchedule(sharedSecret: Uint8Array, info: Uint8Array, aead: Aead) {
  const suite = hpkeSuite(aead);
  const pskIdHash = await labeledExtract(suite, bytes(0), 'psk_id_hash', bytes(0));
  const infoHash = await labeledExtract(suite, bytes(0), 'info_hash', info);
  const context = concat(i2osp(0, 1), pskIdHash, infoHash);
  const secret = await labeledExtract(suite, sharedSecret, 'secret', bytes(0));
  return {
    key: await labeledExpand(suite, secret, 'key', context, keyLength(aead)),
    baseNonce: await labeledExpand(suite, secret, 'base_nonce', context, N_NONCE),
  };
}

async function aeadKey(key: Uint8Array, use: KeyUsage) {
  return crypto.subtle.importKey('raw', concat(key), 'AES-GCM', false, [use]);
}

export interface SealOptions {
  aead?: Aead;
  /** The ephemeral key pair, for the RFC's vectors alone: anything else lets `seal` make a fresh one, which is the point of it. */
  ephemeral?: X25519KeyPair;
}

/** `SealBase` for the first and only message: `enc` (the ephemeral public key) and the ciphertext. */
export async function seal(
  pkR: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
  options: SealOptions = {},
): Promise<{ enc: Bytes; ciphertext: Bytes; sharedSecret: Bytes }> {
  const aead = options.aead ?? AEAD_AES_256_GCM;
  const ephemeral = options.ephemeral ?? (await generateX25519());
  const enc = ephemeral.publicKey;
  const sharedSecret = await kemSharedSecret(await dh(ephemeral.privateKey, pkR), enc, pkR);
  const { key, baseNonce } = await keySchedule(sharedSecret, info, aead);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: baseNonce, additionalData: concat(aad) },
      await aeadKey(key, 'encrypt'),
      concat(plaintext),
    ),
  );
  return { enc, ciphertext, sharedSecret };
}

/** `OpenBase` for the first and only message. A ciphertext that does not open is `tampered`: the caller says whether it was the wrong key. */
export async function open(
  skR: CryptoKey,
  pkR: Uint8Array,
  enc: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
  aead: Aead = AEAD_AES_256_GCM,
): Promise<Bytes> {
  if (enc.length !== N_ENC) throw new CipherError('malformed');
  const sharedSecret = await kemSharedSecret(await dh(skR, enc), enc, pkR);
  const { key, baseNonce } = await keySchedule(sharedSecret, info, aead);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: baseNonce, additionalData: concat(aad) },
        await aeadKey(key, 'decrypt'),
        concat(ciphertext),
      ),
    );
  } catch {
    throw new CipherError('tampered');
  }
}
