import { argon2id } from 'hash-wasm';
import { type Bytes, concat, toBase64Url, utf8 } from './bytes';

/**
 * **The password, turned into two values in the browser** (DESIGN.md §5.3, §14.1): one is sent to sign in, in the password's place, so the server
 * never receives the password; the other unwraps the account key and never leaves the browser. Both come from one Argon2id run of 64 bytes, the
 * first half and the second, and neither half gives the other.
 *
 * - **The salt** is a hash of the instance's address and the email in lower case. A random salt per account would have to be fetched before
 *   sign-in, and answering that request would tell anyone whether an address has an account. The address in it keeps two instances apart.
 * - **The parameters are the protocol version's** (`PASSWORD_V1`): raising them is a new version, which a person moves to at their next sign-in,
 *   and every account key wrap says which version made it.
 * - Argon2id is `hash-wasm`'s, WebAssembly, the one library of the cipher: WebCrypto has none, and a pure JavaScript one takes several seconds for
 *   64 MiB on a phone. The page's policy allows WebAssembly to compile (`'wasm-unsafe-eval'`, `src/security/csp.ts`) and nothing else.
 */
export const PASSWORD_V1 = {
  version: 1,
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 4,
} as const;

export type PasswordParameters = typeof PASSWORD_V1;

export interface PasswordValues {
  /** What the sign-in form sends in the password's place: base64url of 32 bytes. */
  signIn: string;
  /** What unwraps the account key: 32 bytes that stay in the browser. */
  unwrap: Bytes;
}

/** The salt: SHA-256 of a label, the instance's origin and the email in lower case, each separated so that none can run into the next. */
export async function passwordSalt(origin: string, email: string): Promise<Bytes> {
  const text = JSON.stringify([
    'tally/password/1',
    new URL(origin).origin,
    email.trim().toLowerCase(),
  ]);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(text)));
}

export async function derivePassword(
  password: string,
  origin: string,
  email: string,
  parameters: PasswordParameters = PASSWORD_V1,
): Promise<PasswordValues> {
  const hash = await argon2id({
    password: utf8(password.normalize('NFC')),
    salt: await passwordSalt(origin, email),
    memorySize: parameters.memoryKiB,
    iterations: parameters.iterations,
    parallelism: parameters.parallelism,
    hashLength: 64,
    outputType: 'binary',
  });
  const out = concat(hash);
  return { signIn: toBase64Url(out.slice(0, 32)), unwrap: out.slice(32) };
}
