import { type Bytes, bytes, concat, randomBytes } from './bytes';
import { CipherError } from './errors';

/**
 * **The recovery key** (DESIGN.md §5.3): 128 random bits, as a code a person can copy, download, print and type back. Crockford's base32, which has
 * no I, L, O or U, in groups of four: 26 characters for the secret and two for a check, so that a typo is told apart from a code that is not this
 * account's ("Check the code" rather than "This is not your recovery key"). Read back forgivingly: lower case, spaces, dashes, and the letters people
 * write for the digits they look like.
 */
export const RECOVERY_BYTES = 16;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DATA_CHARS = 26;
const CHECK_CHARS = 2;

function toBase32(data: Uint8Array, length: number): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.slice(0, length);
}

function fromBase32(text: string, byteLength: number): Bytes | undefined {
  const out = bytes(byteLength);
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return undefined;
    value = ((value << 5) | digit) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      if (at < byteLength) out[at++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return at === byteLength ? out : undefined;
}

async function checkOf(secret: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', concat(secret)));
  return toBase32(digest, CHECK_CHARS);
}

export function newRecoverySecret(): Bytes {
  return randomBytes(RECOVERY_BYTES);
}

/** The code for a secret: `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`. */
export async function recoveryCode(secret: Uint8Array): Promise<string> {
  if (secret.length !== RECOVERY_BYTES) throw new CipherError('malformed');
  const text = toBase32(secret, DATA_CHARS) + (await checkOf(secret));
  return text.match(/.{1,4}/g)?.join('-') ?? text;
}

/** The secret a typed code stands for, or `malformed` when it is not a code or a character is wrong (the check does not match). */
export async function parseRecoveryCode(typed: string): Promise<Bytes> {
  const text = typed.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (text.length !== DATA_CHARS + CHECK_CHARS) throw new CipherError('malformed');
  const secret = fromBase32(text.slice(0, DATA_CHARS), RECOVERY_BYTES);
  if (!secret || toBase32(secret, DATA_CHARS) !== text.slice(0, DATA_CHARS)) {
    throw new CipherError('malformed');
  }
  if ((await checkOf(secret)) !== text.slice(DATA_CHARS)) throw new CipherError('malformed');
  return secret;
}
