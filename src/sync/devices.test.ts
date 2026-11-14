import 'fake-indexeddb/auto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type Person, type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { addExpense, editExpense, expenseRow, type ExpenseRow } from '../actions';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { opsHandler } from '../groups/api';
import { openLocal } from '../local/db';
import { LocalRefusal, outboxSize, readFailed, readGroupRows } from '../local/store';
import { refusalSentence } from '../actions/validate';
import type { Limiter } from '../limits/rate';
import { toMinor } from '../money/amount';
import { personOfAccount } from '../people/persons';
import { SyncClient, type Transport } from './client';
import { syncHandler } from './endpoint';
import type { SyncResponse } from './format';

/**
 * Two devices, the browser's own store and client over the real endpoint and database (DESIGN.md §11): a write is on the device at once and sent once;
 * one device records offline while the other records too, and once back they hold the same rows; a change the server refuses lands in `failed` with
 * its reason, and leaves the group's rows.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;
const m = (value: number) => toMinor(value);

describe(`two devices (${leg})`, () => {
  let t: TwoAccounts;
  let ops: (request: Request) => Promise<Response>;
  let sync: (request: Request) => Promise<Response>;
  let sealed = '';
  const groupId = crypto.randomUUID();
  const limiter: Limiter = { take: async () => ({ ok: true }) };
  let n = 0;
  const mid = () => `mutation-${++n}-${crypto.randomUUID().slice(0, 8)}`;
  const members = { ada: '', grace: '', sam: crypto.randomUUID() };

  async function device(who: Person, label: string) {
    const db = await openLocal(who.id, `tally-test-${label}-${crypto.randomUUID()}`);
    const state = { offline: false, sent: 0 };
    const transport: Transport = async (request) => {
      if (state.offline) return { kind: 'offline' };
      state.sent += request.mutations.length;
      const reply = await sync(t.request(who, '/api/sync', { method: 'POST', body: request }));
      if (reply.status !== 200) return { kind: 'status', status: reply.status };
      return { kind: 'answer', answer: (await reply.json()) as SyncResponse };
    };
    const personId = (await personOfAccount(t.database, who.id))?.id ?? '';
    return { db, state, client: new SyncClient({ db, transport, personId }) };
  }

  function row(amount: number, split: string[], payer = members.ada): ExpenseRow {
    const made = expenseRow(
      {
        sealed,
        amount: m(amount),
        currency: 'EUR',
        date: '2026-11-02',
        category: 'general',
        method: 'equal',
        payers: [{ memberId: payer, amount: m(amount) }],
        split: split.map((memberId) => ({ memberId, units: null })),
      },
      [members.ada, members.grace, members.sam],
    );
    if (!made.ok) throw new Error(made.refusal.code);
    return made.value;
  }

  const view = async (db: Awaited<ReturnType<typeof device>>['db']) =>
    (await readGroupRows(db, groupId)).expenses
      .map((e) => ({
        id: e.id,
        amount: e.amount,
        version: e.version,
        deletedAt: e.deletedAt,
        shares: e.shares,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));

  beforeAll(async () => {
    t = await twoAccounts();
    ops = accountRoute(
      opsHandler(async () => t.database),
      t.deps,
    );
    sync = accountRoute(
      syncHandler(async () => ({ database: t.database, limiter, now: Date.now })),
      t.deps,
    );
    for (const who of [t.ada, t.grace])
      await ops(
        t.request(who, '/api/ops', { method: 'POST', body: { op: 'group.read', groupId } }),
      );
    sealed = await sealRow(
      { description: 'x', note: null },
      await importGroupKey(newGroupKey()),
      1,
      { group: groupId, table: 'expense', row: 'x' },
    );
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
    );
    const db = tables(t.database);
    const found = await dbGet<{ id: string }>(
      t.database,
      sql`SELECT id FROM ${db.member} WHERE group_id = ${groupId}`,
    );
    members.ada = found?.id ?? '';
    members.grace = crypto.randomUUID();
    const samPerson = crypto.randomUUID();
    await dbRun(
      t.database,
      sql`INSERT INTO ${db.person} (id, name, created_at, updated_at) VALUES (${samPerson}, 'Sam', 1, 1)`,
    );
    const gracePerson = (await personOfAccount(t.database, t.grace.id))?.id ?? '';
    for (const [id, personId, role, at] of [
      [members.grace, gracePerson, 'member', 2],
      [members.sam, samPerson, null, 3],
    ] as const)
      await dbRun(
        t.database,
        sql`INSERT INTO ${db.member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
            VALUES (${id}, ${groupId}, ${personId}, ${role}, 'all', NULL, ${Date.now() + at}, NULL, 1)`,
      );
  });
  afterAll(async () => t.close());

  it('shows a write at once, sends it once, and refuses at once what the server would refuse', async () => {
    const ada = await device(t.ada, 'ada');
    expect(await ada.client.sync()).toEqual({ status: 'synced' });
    const expenseId = crypto.randomUUID();
    await ada.client.commit(
      addExpense({
        mutationId: mid(),
        groupId,
        expenseId,
        row: row(900, [members.ada, members.grace, members.sam]),
      }),
    );
    expect((await view(ada.db)).map((e) => e.id)).toEqual([expenseId]);
    expect(await outboxSize(ada.db)).toBe(1);
    await ada.client.sync();
    await ada.client.sync();
    expect(ada.state.sent).toBe(1);
    expect(await outboxSize(ada.db)).toBe(0);
    expect((await view(ada.db))[0]).toMatchObject({ id: expenseId, version: 1 });
    // Shares that do not add up are refused on the device, and nothing is queued.
    const bad = row(900, [members.ada]);
    await expect(
      ada.client.commit(
        addExpense({
          mutationId: mid(),
          groupId,
          expenseId: crypto.randomUUID(),
          row: { ...bad, shares: bad.shares.map((sh) => ({ ...sh, amount: m(1) })) },
        }),
      ),
    ).rejects.toBeInstanceOf(LocalRefusal);
    expect(await outboxSize(ada.db)).toBe(0);
  });

  it('converges: one device records offline while the other records, and both end with the same rows', async () => {
    const ada = await device(t.ada, 'ada2');
    const grace = await device(t.grace, 'grace');
    await ada.client.sync();
    await grace.client.sync();
    const shared = (await view(ada.db))[0];
    if (!shared) throw new Error('fixture');

    grace.state.offline = true;
    const offline = crypto.randomUUID();
    await grace.client.commit(
      addExpense({
        mutationId: mid(),
        groupId,
        expenseId: offline,
        row: row(1_200, [members.ada, members.grace], members.grace),
      }),
    );
    await grace.client.commit(
      editExpense({
        mutationId: mid(),
        groupId,
        current: { id: shared.id, version: shared.version },
        row: row(600, [members.ada, members.grace]),
      }),
    );
    expect(await grace.client.sync()).toEqual({ status: 'offline' });
    expect((await view(grace.db)).find((e) => e.id === offline)).toBeDefined();

    // Meanwhile Ada edits the same expense, and adds one.
    await ada.client.commit(
      editExpense({
        mutationId: mid(),
        groupId,
        current: { id: shared.id, version: shared.version },
        row: row(300, [members.ada, members.grace, members.sam]),
      }),
    );
    await ada.client.commit(
      addExpense({
        mutationId: mid(),
        groupId,
        expenseId: crypto.randomUUID(),
        row: row(3_000, [members.ada, members.sam]),
      }),
    );
    await ada.client.sync();

    grace.state.offline = false;
    expect(await grace.client.sync()).toEqual({ status: 'synced' });
    await ada.client.sync();
    expect(await outboxSize(grace.db)).toBe(0);
    const graces = await view(grace.db);
    expect(graces).toEqual(await view(ada.db));
    // The edit that reached the server later, Grace's, stands whole.
    expect(graces.find((e) => e.id === shared.id)).toMatchObject({ amount: 600 });
    expect(graces.find((e) => e.id === offline)).toMatchObject({ amount: 1_200, version: 1 });
  });

  it('keeps a refused change in failed, with its reason, and takes it off the group’s rows', async () => {
    const grace = await device(t.grace, 'grace2');
    await grace.client.sync();
    grace.state.offline = true;
    const withSam = crypto.randomUUID();
    await grace.client.commit(
      addExpense({
        mutationId: mid(),
        groupId,
        expenseId: withSam,
        row: row(200, [members.grace, members.sam], members.grace),
      }),
    );
    // Sam leaves while Grace is offline.
    await dbRun(
      t.database,
      sql`UPDATE ${tables(t.database).member} SET left_at = 1, seq = 1000 WHERE id = ${members.sam}`,
    );
    await dbRun(
      t.database,
      sql`UPDATE ${tables(t.database).grp} SET seq = 1000 WHERE id = ${groupId}`,
    );
    grace.state.offline = false;
    const told: string[] = [];
    grace.client.onRefused((refused) => told.push(...refused.map((r) => r.refusal.code)));
    await grace.client.sync();
    expect(told).toEqual(['member_gone']);
    const failed = await readFailed(grace.db);
    expect(failed.map((f) => [f.refusal, f.mutation.changes[0]?.id])).toEqual([
      [{ code: 'member_gone', memberId: members.sam }, withSam],
    ]);
    expect((await view(grace.db)).find((e) => e.id === withSam)).toBeUndefined();
    expect(await outboxSize(grace.db)).toBe(0);
  });
  it('lands a change recorded offline in a group closed meanwhile in Couldn’t sync, from where it moves to another group', async () => {
    // Two groups of Ada's and Grace's, Lisbon and Porto, with nothing in them.
    const db = tables(t.database);
    const gracePerson = (await personOfAccount(t.database, t.grace.id))?.id ?? '';
    const make = async () => {
      const id = crypto.randomUUID();
      await ops(
        t.request(t.ada, '/api/ops', {
          method: 'POST',
          body: {
            op: 'group.create',
            groupId: id,
            sealed,
            color: '#2563eb',
            defaultCurrency: 'EUR',
            keyWrap: WRAP,
          },
        }),
      );
      const adaMember =
        (
          await dbGet<{ id: string }>(
            t.database,
            sql`SELECT id FROM ${db.member} WHERE group_id = ${id}`,
          )
        )?.id ?? '';
      const graceMember = crypto.randomUUID();
      await dbRun(
        t.database,
        sql`INSERT INTO ${db.member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
            VALUES (${graceMember}, ${id}, ${gracePerson}, 'member', 'all', NULL, ${Date.now() + 9}, NULL, 1)`,
      );
      return { id, ada: adaMember, grace: graceMember };
    };
    const lisbon = await make();
    const porto = await make();
    const ada = await device(t.ada, 'ada3');
    await ada.client.sync();

    ada.state.offline = true;
    const recorded = expenseRow(
      {
        sealed,
        amount: m(4_000),
        currency: 'EUR',
        date: '2026-11-04',
        category: 'eating_out',
        method: 'equal',
        payers: [{ memberId: lisbon.ada, amount: m(4_000) }],
        split: [lisbon.ada, lisbon.grace].map((memberId) => ({ memberId, units: null })),
      },
      [lisbon.ada, lisbon.grace],
    );
    if (!recorded.ok) throw new Error('fixture');
    await ada.client.commit(
      addExpense({
        mutationId: mid(),
        groupId: lisbon.id,
        expenseId: crypto.randomUUID(),
        row: recorded.value,
      }),
    );
    // Lisbon is closed from elsewhere while this device is offline.
    expect(
      (
        await ops(
          t.request(t.ada, '/api/ops', {
            method: 'POST',
            body: { op: 'group.close', groupId: lisbon.id },
          }),
        )
      ).status,
    ).toBe(200);
    ada.state.offline = false;
    await ada.client.sync();

    const [failed] = await readFailed(ada.db);
    if (!failed) throw new Error('not kept');
    expect(failed.refusal).toEqual({ code: 'closed' });
    expect(refusalSentence(failed.refusal, { group: 'Lisbon' })).toBe('Lisbon was closed.');
    expect((await readGroupRows(ada.db, lisbon.id)).expenses).toEqual([]);

    // Moved to Porto: the same people, found there by person, its text sealed again for its new row.
    const resealed: string[] = [];
    await ada.client.move(failed.mutationId, porto.id, async (_text, _from, to) => {
      const again = await sealRow(
        { description: 'Dinner', note: null },
        await importGroupKey(newGroupKey()),
        1,
        to,
      );
      resealed.push(to.group);
      return again;
    });
    expect(resealed).toEqual([porto.id]);
    expect(await readFailed(ada.db)).toEqual([]);
    expect(await ada.client.sync()).toEqual({ status: 'synced' });
    const stored = await dbGet<{ amount: number }>(
      t.database,
      sql`SELECT amount FROM ${db.expense} WHERE group_id = ${porto.id}`,
    );
    expect(Number(stored?.amount)).toBe(4_000);
    const shares = (await readGroupRows(ada.db, porto.id)).expenses[0]?.shares
      .map((x) => x.memberId)
      .sort();
    expect(shares).toEqual([porto.ada, porto.grace].sort());
  });
});
