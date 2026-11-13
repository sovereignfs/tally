/**
 * **What the server takes in a password's place** (DESIGN.md §5.3, §14.1): base64url of the 32 bytes Argon2id made from the password in the browser
 * (`src/cipher/password.ts`), 43 characters. The server stores better-auth's own hash of it, as it would of a password, and never sees the password.
 * The fields of better-auth's routes that would hold a password must hold this.
 */
export const SIGN_IN_VALUE = /^[A-Za-z0-9_-]{43}$/;

export const PASSWORD_FIELDS = ['password', 'newPassword', 'currentPassword'] as const;

/** The code of a reset given an address the link was not sent to. */
export const WRONG_RESET_EMAIL = 'WRONG_RESET_EMAIL';

export function isSignInValue(value: unknown): value is string {
  return typeof value === 'string' && SIGN_IN_VALUE.test(value);
}
