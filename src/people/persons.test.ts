import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeAuth, type TestAuth } from '../auth/test-support';
import type { Database } from '../db/client';
import { dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { openStoreBesideAuth } from '../db/test-store';
import { testTarget } from '../db/test-support';
import { allPersons, cleanName, ensurePerson, personOfAccount } from './persons';
import { emailVisible, viewPerson } from './visibility';

const { leg } = testTarget();

describe(`persons (${leg})`, () => {
  let t: TestAuth;
  let store: { database: Database; close(): Promise<void> };

  beforeAll(async () => {
    // The auth store first, then the app's beside it (src/db/test-store.ts), and the hook makes the person in the app's.
    const app: { database?: Database } = {};
    t = await makeAuth({ signUp: 'open' }, undefined, async (account) => {
      if (!app.database) throw new Error('the app store is not open yet');
      await ensurePerson(app.database, account);
    });
    store = await openStoreBesideAuth();
    app.database = store.database;
    await dbRun(store.database, sql`DELETE FROM ${tables(store.database).person}`);
  });
  afterAll(async () => {
    await store.close();
    await t.close();
  });

  it('gives a new account exactly one person, with the name and address it signed up with', async () => {
    const client = t.client();
    const reply = await client.post('/api/auth/sign-up/email', {
      name: '  Ada   Lovelace ',
      email: 'Ada@Example.com',
      password: 'correct horse battery',
    });
    expect(reply.status).toBe(200);
    const accountId = reply.body.user.id as string;
    const person = await personOfAccount(store.database, accountId);
    expect(person).toMatchObject({ accountId, name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(
      (await allPersons(store.database)).filter((p) => p.accountId === accountId),
    ).toHaveLength(1);
  });

  it('is made once, however many times and from however many places it is asked for at once', async () => {
    const account = { id: 'account-race', name: 'Race', email: 'race@example.com' };
    const made = await Promise.all(
      Array.from({ length: 8 }, () => ensurePerson(store.database, account)),
    );
    expect(new Set(made.map((person) => person.id)).size).toBe(1);
    expect(
      (await allPersons(store.database)).filter((p) => p.accountId === 'account-race'),
    ).toHaveLength(1);
  });

  it('is never overwritten by asking again: the name is the person’s to change', async () => {
    const first = await ensurePerson(store.database, {
      id: 'account-keep',
      name: 'Kasun',
      email: 'k@example.com',
    });
    const again = await ensurePerson(store.database, {
      id: 'account-keep',
      name: 'Someone Else',
      email: 'other@example.com',
    });
    expect(again).toMatchObject({ id: first.id, name: 'Kasun', email: 'k@example.com' });
  });

  it('can exist with no account: a placeholder', async () => {
    const now = Date.now();
    await dbRun(
      store.database,
      sql`INSERT INTO ${tables(store.database).person} (id, name, email, added_by, created_at, updated_at)
          VALUES ('placeholder-1', 'Sam', NULL, 'someone', ${now}, ${now}),
                 ('placeholder-2', 'Sam', NULL, 'someone', ${now}, ${now})`,
    );
    const placeholders = (await allPersons(store.database)).filter((p) => p.accountId === null);
    expect(placeholders.map((p) => p.id)).toEqual(
      expect.arrayContaining(['placeholder-1', 'placeholder-2']),
    );
  });

  it('gets a name from the address when the account has none', async () => {
    const person = await ensurePerson(store.database, {
      id: 'account-noname',
      name: '   ',
      email: 'zoe@example.com',
    });
    expect(person.name).toBe('zoe');
  });
});

describe('a name', () => {
  it('is trimmed, its runs of space made one, and kept to a hundred characters', () => {
    expect(cleanName('  Thulana \n  Perera  ')).toBe('Thulana Perera');
    expect([...cleanName('x'.repeat(150))]).toHaveLength(100);
    expect(cleanName('   ')).toBe('');
  });
});

describe('who may see an email', () => {
  const me = { accountId: 'a-me', personId: 'p-me' };
  const self = { id: 'p-me', accountId: 'a-me', addedBy: null };
  const member = { id: 'p-other', accountId: 'a-other', addedBy: null };
  const myPlaceholder = { id: 'p-sam', accountId: null, addedBy: 'p-me' };
  const theirPlaceholder = { id: 'p-jo', accountId: null, addedBy: 'p-other' };

  it('is the person themselves', () => {
    expect(emailVisible(me, self)).toBe(true);
  });

  it('is an owner of a group they are in, and no other member', () => {
    expect(emailVisible(me, member)).toBe(false);
    expect(emailVisible(me, member, { ownsAGroupTheyAreIn: true })).toBe(true);
  });

  it('is whoever added a placeholder, and not someone else’s placeholder', () => {
    expect(emailVisible(me, myPlaceholder)).toBe(true);
    expect(emailVisible(me, theirPlaceholder)).toBe(false);
  });

  it('is applied by the view of a person, which shows the name to everyone and nothing else of the record', () => {
    const view = viewPerson(me, {
      ...member,
      name: 'Thulana',
      email: 't@example.com',
      deletedAt: null,
    });
    expect(view).toEqual({
      id: 'p-other',
      name: 'Thulana',
      email: null,
      placeholder: false,
      leftTally: false,
    });
    expect(
      viewPerson(me, { ...myPlaceholder, name: 'Sam', email: 's@example.com', deletedAt: null }),
    ).toMatchObject({
      email: 's@example.com',
      placeholder: true,
    });
    expect(
      viewPerson(me, {
        id: 'p-gone',
        accountId: null,
        addedBy: null,
        name: 'Sam',
        email: null,
        deletedAt: 1,
      }),
    ).toMatchObject({ placeholder: false, leftTally: true });
  });
});
