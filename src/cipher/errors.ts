/**
 * What can go wrong opening something, told apart so that the screen says the right thing: **a key that is not the one it was sealed with**
 * (`wrong_key`: the person gave the wrong password or code) is not **a value that is not a sealed value at all, or was changed** (`malformed`, or
 * `tampered` when its form is right and it does not open: the server or the disk changed it, or it belongs to another row). AES-GCM cannot tell a
 * wrong key from a changed value; where only one key could have sealed it, the caller knows which it is, and says so.
 */
export type CipherErrorKind = 'malformed' | 'wrong_key' | 'tampered' | 'unsupported';

export class CipherError extends Error {
  constructor(readonly kind: CipherErrorKind) {
    super(`cipher: ${kind}`);
    this.name = 'CipherError';
  }
}
