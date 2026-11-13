import {
  type Bytes,
  bytes,
  concat,
  fromBase64Url,
  fromUtf8,
  randomBytes,
  toBase64Url,
  utf8,
} from './bytes';
import { CipherError } from './errors';

/**
 * **A sealed row** (DESIGN.md §5.3): what is sealed of a row (a group's `{name}`, an expense's `{description, note}`, a payment's `{note}`, a comment's
 * `{body}`) as one JSON object, AES-256-GCM under the group key of an epoch, with a random 96-bit nonce and **the group, the table, the row and the
 * epoch as authenticated data**, so that the server cannot move a blob to another row, table or group, or claim another epoch, and have it open.
 *
 * The JSON is padded with spaces to a multiple of 32 bytes before sealing, so that the length of a sealed row says little about what was written: a
 * reader of the database sees which bucket a description falls in, not its length.
 *
 * The form is `s1.<epoch>.<base64url(nonce ‖ ciphertext ‖ tag)>`: `s1` is the form's version, and a changed form is a new version that still opens the
 * old. The epoch is plain, because the reader needs it to choose the key; it is also bound, so changing it does not help.
 */
export const GROUP_KEY_BYTES = 32;
export const PAD_TO = 32;
const VERSION = 's1';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface RowBinding {
  readonly group: string;
  readonly table: 'grp' | 'expense' | 'payment' | 'comment' | 'receipt';
  readonly row: string;
}

export function newGroupKey(): Bytes {
  return randomBytes(GROUP_KEY_BYTES);
}

/** A group key as a browser key that script cannot read back, for sealing and opening. */
export function importGroupKey(key: Uint8Array): Promise<CryptoKey> {
  if (key.length !== GROUP_KEY_BYTES) throw new CipherError('malformed');
  return crypto.subtle.importKey('raw', concat(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** The authenticated data: a JSON array, so that no choice of group, table or row can be read as another. */
function aadOf(binding: RowBinding, epoch: number): Bytes {
  return utf8(JSON.stringify(['tally/sealed/1', binding.group, binding.table, binding.row, epoch]));
}

function pad(text: string): Bytes {
  const raw = utf8(text);
  const length = Math.max(PAD_TO, Math.ceil(raw.length / PAD_TO) * PAD_TO);
  const out = bytes(length).fill(0x20);
  out.set(raw);
  return out;
}

const isEpoch = (epoch: number) => Number.isSafeInteger(epoch) && epoch >= 1;

/** Seals `content` (a plain object of strings or nulls) for one row under one epoch's key. */
export async function sealRow(
  content: Readonly<Record<string, string | null>>,
  key: CryptoKey,
  epoch: number,
  binding: RowBinding,
): Promise<string> {
  if (!isEpoch(epoch)) throw new CipherError('malformed');
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aadOf(binding, epoch) },
      key,
      pad(JSON.stringify(content)),
    ),
  );
  return `${VERSION}.${epoch}.${toBase64Url(concat(nonce, ciphertext))}`;
}

/** The epoch and the bytes of a sealed value, or `malformed`. Used by the server's form check too, which has no key and needs none. */
export function parseSealed(sealed: string): { epoch: number; body: Bytes } {
  const parts = sealed.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) throw new CipherError('malformed');
  const [, epochText = '', bodyText = ''] = parts;
  const epoch = /^[1-9][0-9]{0,15}$/.test(epochText) ? Number(epochText) : Number.NaN;
  const body = fromBase64Url(bodyText);
  if (!isEpoch(epoch) || !body || body.length < NONCE_BYTES + TAG_BYTES + PAD_TO) {
    throw new CipherError('malformed');
  }
  return { epoch, body };
}

/** The epoch a sealed value says it is under, so that the reader can choose the key. */
export const epochOf = (sealed: string): number => parseSealed(sealed).epoch;

/** Opens a sealed row: its content, or `malformed` (not a sealed value) or `tampered` (does not open with this key for this row). */
export async function openRow(
  sealed: string,
  key: CryptoKey,
  binding: RowBinding,
): Promise<Record<string, string | null>> {
  const { epoch, body } = parseSealed(sealed);
  let plain: Bytes;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: body.slice(0, NONCE_BYTES), additionalData: aadOf(binding, epoch) },
        key,
        body.slice(NONCE_BYTES),
      ),
    );
  } catch {
    throw new CipherError('tampered');
  }
  const value: unknown = JSON.parse(fromUtf8(plain));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CipherError('malformed');
  }
  return value as Record<string, string | null>;
}
