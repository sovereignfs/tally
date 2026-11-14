'use client';

import { derivePassword, type PasswordValues } from '../cipher/password';

/**
 * The browser's half of "the password never reaches the server" (DESIGN.md §14.1): what a form sends in a password's place, for this instance and
 * this address, and in the same run the value that unlocks the account's key (§5.3). The length a person chose is checked before this, by the form,
 * since the server only ever sees 43 characters.
 */
export function passwordValues(password: string, email: string): Promise<PasswordValues> {
  return derivePassword(password, window.location.origin, email);
}

export async function signInValue(password: string, email: string): Promise<string> {
  return (await passwordValues(password, email)).signIn;
}
