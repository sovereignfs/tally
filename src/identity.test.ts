import { describe, expect, it } from 'vitest';
import { parseIdentity } from './identity';

/** Who is signed in on the device (DESIGN.md §15.11): only exactly an identity is read back; anything else is no one. */
describe('the identity kept on the device', () => {
  it('reads back exactly an identity', () => {
    const me = { id: 'acct', personId: 'person', name: 'Ada', email: 'ada@example.com' };
    expect(parseIdentity(JSON.stringify(me))).toEqual(me);
  });

  it('is no one for anything else', () => {
    for (const text of [
      null,
      '',
      'not json',
      '[]',
      '{}',
      JSON.stringify({ id: 'acct', name: 'Ada', email: 'a' }),
      JSON.stringify({ id: '', personId: 'p', name: 'A', email: 'a' }),
    ])
      expect(parseIdentity(text), String(text)).toBeNull();
  });
});
