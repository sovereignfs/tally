import { createSovereign } from '@sovereignfs/sdk';
import { createFakeCore } from '@sovereignfs/sdk/testing';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { addExpense, expenseRow } from '../actions';
import { balances } from '../balances';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { putCredential, readCredential } from '../crypto/credentials';
import { ringOf } from '../crypto/keys';
import { dbAll, dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { opsHandler } from '../groups/api';
import { groupRows } from '../groups/lifecycle';
import { addPerson } from '../groups/people';
import { toMinor } from '../money/amount';
import { setNoticeMailForTests } from '../notices/mail';
import { linkCoreIdentity, personOfAccount } from '../people/persons';
import { applyMutation } from '../sync/apply';
import { type DirectorySource, searchDirectory } from './directory';
import { CORE_TOKEN, coreTokenStore } from './tokens';

/**
 * Core's directory (DESIGN.md §6.2, §14.4), on each database, against `@sovereignfs/sdk`'s fake core: the refresh token kept sealed and rotated as the
 * SDK requires, one refresh at a time; searching as the person; someone found added as a person linked to their `sub`, told by core's bell, whose first
 * sign-in finds the group with their history; and no directory (no scope, an older core, not linked) leaving the field to Tally alone.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;
const RING = ringOf(Buffer.alloc(32, 9)) as NonNullable<ReturnType<typeof ringOf>>;

describe(`core's directory (${leg})`, () => {
  let t: TwoAccounts;
  let ada: { accountId: string; personId: string };
  const db = () => tables(t.database);

  function world(capabilities: string[] = ['directory', 'notifications', 'email', 'activity']) {
    const fake = createFakeCore({ api: { versions: ['v1'], capabilities } });
    fake.addPerson({ sub: 'core-ada', name: 'Ada' });
    fake.addPerson({ sub: 'core-grace', name: 'Grace at Sovereign' });
    fake.addPerson({ sub: 'core-sam', name: 'Sam Samson' });
    const sovereign = createSovereign({
      appUrl: 'https://tally.example',
      coreUrl: fake.url,
      clientId: fake.credentials.clientId,
      clientSecret: fake.credentials.clientSecret,
      tokenStore: coreTokenStore(t.database, RING),
      fetch: fake.fetch,
    });
    const source: DirectorySource = (sub) => sovereign.as({ sub }).directory;
    return { fake, source };
  }

  beforeAll(async () => {
    t = await twoAccounts();
    const ops = accountRoute(
      opsHandler(async () => t.database),
      t.deps,
    );
    for (const who of [t.ada, t.grace])
      await ops(
        t.request(who, '/api/ops', {
          method: 'POST',
          body: { op: 'group.read', groupId: crypto.randomUUID() },
        }),
      );
    ada = {
      accountId: t.ada.id,
      personId: (await personOfAccount(t.database, t.ada.id))?.id ?? '',
    };
    await dbRun(
      t.database,
      sql`UPDATE ${db().person} SET core_sub = 'core-ada' WHERE id = ${ada.personId}`,
    );
  });
  afterEach(() => setNoticeMailForTests(null));
  afterAll(async () => t.close());

  it('keeps the token sealed, stores a new one only in place of the one it replaces, and lets one refresh at a time', async () => {
    const store = coreTokenStore(t.database, RING);
    await putCredential(t.database, RING, t.ada.id, CORE_TOKEN, 'first-token');
    const row = await dbGet<{ sealed: string }>(
      t.database,
      sql`SELECT sealed FROM ${db().credential} WHERE account_id = ${t.ada.id}`,
    );
    expect(row?.sealed).not.toContain('first-token');
    expect(await store.read('core-ada')).toBe('first-token');
    expect(await store.write('core-ada', 'second', 'not-the-stored-one')).toBe(false);
    expect(await store.write('core-ada', 'second', 'first-token')).toBe(true);
    expect(await store.write('core-ada', 'third', 'first-token')).toBe(false);
    expect(await store.read('core-ada')).toBe('second');
    expect(await store.read('nobody')).toBeUndefined();
    // Two at once take turns: the second starts after the first is done.
    const order: string[] = [];
    await Promise.all(
      ['a', 'b'].map((name) =>
        store.lock('core-ada', async () => {
          order.push(`${name} in`);
          await new Promise((resolve) => setTimeout(resolve, 50));
          order.push(`${name} out`);
        }),
      ),
    );
    expect([order[0]?.slice(2), order[1]?.slice(2)]).toEqual(['in', 'out']);
  });

  it('searches the directory as the person, rotating their token, and says who is here already', async () => {
    const { fake, source } = world();
    await putCredential(t.database, RING, t.ada.id, CORE_TOKEN, fake.signIn('core-ada'));
    const before = (await readCredential(t.database, RING, t.ada.id, CORE_TOKEN))?.plain;
    const found = await searchDirectory(t.database, ada, { q: 'Sam' }, source);
    expect(found).toEqual({
      available: true,
      people: [{ sub: 'core-sam', name: 'Sam Samson', personId: null }],
    });
    // Herself is not offered.
    expect((await searchDirectory(t.database, ada, { q: 'Ada' }, source)).people).toEqual([]);
    expect((await readCredential(t.database, RING, t.ada.id, CORE_TOKEN))?.plain).not.toBe(before);
    expect(fake.seen.reused).toBe(0);
  });

  it('adds someone found there, tells them by core’s bell, and their first sign-in finds the group with their history', async () => {
    setNoticeMailForTests({ origin: 'https://tally.example', smtp: false, core: true });
    const groupId = crypto.randomUUID();
    const sealed = await sealRow({ name: 'Lisbon' }, await importGroupKey(newGroupKey()), 1, {
      group: 'g',
      table: 'grp',
      row: 'g',
    });
    const ops = accountRoute(
      opsHandler(async () => t.database),
      t.deps,
    );
    expect(
      (
        await ops(
          t.request(t.ada, '/api/ops', {
            method: 'POST',
            body: {
              op: 'group.create',
              groupId,
              sealed,
              color: '#2563eb',
              defaultCurrency: 'EUR',
              keyWrap: WRAP,
            },
          }),
        )
      ).status,
    ).toBe(201);
    const added = await addPerson(t.database, ada, {
      groupId,
      coreSub: 'core-grace',
      name: 'Grace at Sovereign',
    });
    expect(added.placeholder).toBe(true);
    expect(
      await dbGet(
        t.database,
        sql`SELECT core_sub AS "coreSub", account_id AS "accountId", name FROM ${db().person} WHERE id = ${added.personId}`,
      ),
    ).toEqual({ coreSub: 'core-grace', accountId: null, name: 'Grace at Sovereign' });
    const told = await dbAll<{ data: string }>(
      t.database,
      sql`SELECT data FROM ${db().mailOutbox} WHERE template = 'core_notice' AND account_id IS NULL`,
    );
    expect(told.map((r) => JSON.parse(r.data))).toContainEqual(
      expect.objectContaining({ kind: 'added_to_group', sub: 'core-grace', actorName: 'Ada' }),
    );
    // Added twice, from two searches: the same person.
    await expect(
      addPerson(t.database, ada, { groupId, coreSub: 'core-grace', name: 'Grace' }),
    ).rejects.toThrow();

    // Ada pays 30.00 for the two of them.
    const adaMember =
      (
        await dbGet<{ id: string }>(
          t.database,
          sql`SELECT id FROM ${db().member} WHERE group_id = ${groupId} AND person_id = ${ada.personId}`,
        )
      )?.id ?? '';
    const row = expenseRow(
      {
        sealed,
        amount: toMinor(3_000),
        currency: 'EUR',
        date: '2026-11-02',
        category: 'general',
        method: 'equal',
        payers: [{ memberId: adaMember, amount: toMinor(3_000) }],
        split: [adaMember, added.memberId].map((memberId) => ({ memberId, units: null })),
      },
      [adaMember, added.memberId],
    );
    if (!row.ok) throw new Error(row.refusal.code);
    await applyMutation(
      t.database,
      ada,
      addExpense({
        mutationId: crypto.randomUUID(),
        groupId,
        expenseId: crypto.randomUUID(),
        row: row.value,
      }),
    );

    // Grace signs in through core for the first time: her account claims the person by `sub`, with the group and her share in it.
    await linkCoreIdentity(
      t.database,
      { id: t.grace.id, name: 'Grace', email: t.grace.email },
      'core-grace',
    );
    const grace = await personOfAccount(t.database, t.grace.id);
    expect(
      await dbGet(
        t.database,
        sql`SELECT person_id AS "personId" FROM ${db().member} WHERE id = ${added.memberId}`,
      ),
    ).toEqual({ personId: grace?.id });
    const { rows, order } = await groupRows(t.database, groupId);
    expect(balances(rows, order).get('EUR')?.get(added.memberId)).toBe(-1_500);
  });

  it('leaves the field to Tally alone without the directory: no scope, an older core, or someone not linked', async () => {
    const noScope = world(['notifications', 'email', 'activity']);
    await putCredential(t.database, RING, t.ada.id, CORE_TOKEN, noScope.fake.signIn('core-ada'));
    expect(await searchDirectory(t.database, ada, { q: 'Sam' }, noScope.source)).toEqual({
      available: false,
      people: [],
    });
    expect(await searchDirectory(t.database, ada, { q: 'Sam' }, undefined)).toEqual({
      available: false,
      people: [],
    });
    const grace = { accountId: t.grace.id, personId: '' };
    expect(await searchDirectory(t.database, grace, { q: 'Sam' }, world().source)).toEqual({
      available: false,
      people: [],
    });
    await expect(searchDirectory(t.database, ada, { q: 'S' }, world().source)).rejects.toThrow();
  });
});
