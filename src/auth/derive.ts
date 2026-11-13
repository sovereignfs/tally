'use client';

import { derivePassword } from '../cipher/password';

/**
 * The browser's half of "the password never reaches the server" (DESIGN.md §14.1): what a form sends in a password's place, for this instance and
 * this address. The length a person chose is checked before this, by the form, since the server only ever sees 43 characters.
 */
export async function signInValue(password: string, email: string): Promise<string> {
  return (await derivePassword(password, window.location.origin, email)).signIn;
}
