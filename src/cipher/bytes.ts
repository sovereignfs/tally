/**
 * Bytes as the cipher handles them: `Uint8Array<ArrayBuffer>`, which WebCrypto takes as it is, and base64url without padding for every form that
 * travels or is stored, so that a sealed value holds nothing but that alphabet and the dots between its parts.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

export function bytes(length: number): Bytes {
  return new Uint8Array(new ArrayBuffer(length));
}

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(bytes(length));
}

export function concat(...parts: readonly Uint8Array[]): Bytes {
  const out = bytes(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function utf8(text: string): Bytes {
  const encoded = new TextEncoder().encode(text);
  const out = bytes(encoded.length);
  out.set(encoded);
  return out;
}

export function fromUtf8(data: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(data);
}

/** `I2OSP(n, length)`: a whole number as big-endian bytes. */
export function i2osp(value: number, length: number): Bytes {
  const out = bytes(length);
  let rest = value;
  for (let index = length - 1; index >= 0; index--) {
    out[index] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
  return out;
}

export function fromHex(hex: string): Bytes {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error('not hex');
  const out = bytes(hex.length / 2);
  for (let index = 0; index < out.length; index++) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

export function toHex(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(data: Uint8Array): string {
  let out = '';
  for (let index = 0; index < data.length; index += 3) {
    const a = data[index] ?? 0;
    const b = data[index + 1] ?? 0;
    const c = data[index + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    const left = data.length - index;
    out += ALPHABET[(triple >> 18) & 63];
    out += ALPHABET[(triple >> 12) & 63];
    if (left > 1) out += ALPHABET[(triple >> 6) & 63];
    if (left > 2) out += ALPHABET[triple & 63];
  }
  return out;
}

/** The bytes of base64url text, or `undefined` for anything that is not exactly that (padding, other characters, a length no encoding has). */
export function fromBase64Url(text: string): Bytes | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return undefined;
  const out = bytes(Math.floor((text.length * 3) / 4));
  let at = 0;
  for (let index = 0; index < text.length; index += 4) {
    const values = [0, 1, 2, 3].map((offset) => {
      const char = text[index + offset];
      return char === undefined ? 0 : ALPHABET.indexOf(char);
    });
    const [a = 0, b = 0, c = 0, d = 0] = values;
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    const left = text.length - index;
    out[at++] = (triple >> 16) & 0xff;
    if (left > 2) out[at++] = (triple >> 8) & 0xff;
    if (left > 3) out[at++] = triple & 0xff;
  }
  // A last character with bits the length does not use is a different text for the same bytes: refused, so that each value has one form.
  return toBase64Url(out) === text ? out : undefined;
}
