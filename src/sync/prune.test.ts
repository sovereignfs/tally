import 'fake-indexeddb/auto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type Person, type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { addComment, addExpense, deleteComment, expenseRow } from '../actions';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { opsHandler } from '../groups/api';
import { openLocal } from '../local/db';
import { readGroupRows } from '../local/store';
import type { Limiter } from '../limits/rate';
import { toMinor } from '../money/amount';
import { personOfAccount } from '../people/persons';
import { SyncClient, type Transport } from './client';
import { syncHandler } from './endpoint';
import type { SyncResponse } from './format';
import { COMMENTS_AFTER_MS, KEEP_MS, prune } from './prune';

/**
 * Keeping the history small (DESIGN.md §11.8) on each database: deleted comments removed after 30 days, leaving tombstones a device learns from;
 * tombstones and applied mutations forgotten after 90; a device away for longer than that resyncs to the same rows as a fresh one; the job safe twice and
 * from two at once.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;
const DAY = 24 * 60 * 60 * 1000;

describe(`pruning the history (${leg})`, () => {
  let t: TwoAccounts;
  let ops: (request: Request) => Promise<Response>;
  let sync: (request: Request) => Promise<Response>;
  let sealed = '';
  const groupId = crypto.randomUUID();
  let member = '';
  let n = 0;
  const mid = () => `mutation-${++n}-${crypto.randomUUID().slice(0, 8)}`;
  const limiter: Limiter = { take: async () => ({ ok: true }) };
  const count = async (table: unknown, where = sql`1 = 1`) =>
    Number(
      (
        await dbGet<{ n: number }>(
          t.database,
          sql`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`,
        )
      )?.n ?? 0,
    );

  async function device(who: Person) {
    const db = await openLocal(who.id, `tally-prune-${crypto.randomUUID()}`);
    const transport: Transport = async (request) => {
      const reply = await sync(t.request(who, '/api/sync', { method: 'POST', body: request }));
      if (reply.status !== 200) return { kind: 'status', status: reply.status };
      return { kind: 'answer', answer: (await reply.json()) as SyncResponse };
    };
    const personId = (await personOfAccount(t.database, who.id))?.id ?? '';
    return { db, client: new SyncClient({ db, transport, personId }) };
  }
  const view = async (db: Awaited<ReturnType<typeof device>>['db']) => {
    const rows = await readGroupRows(db, groupId);
    return {
      expenses: rows.expenses.map((e) => e.id).sort(),
      comments: rows.comments
        .map((c) => `${c.id} ${c.deletedAt === null ? 'live' : 'deleted'}`)
        .sort(),
    };
  };

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
    await ops(
      t.request(t.ada, '/api/ops', { method: 'POST', body: { op: 'group.read', groupId } }),
    );
    sealed = await sealRow({ body: 'x' }, await importGroupKey(newGroupKey()), 1, {
      group: groupId,
      table: 'comment',
      row: 'x',
    });
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
    member =
      (
        await dbGet<{ id: string }>(
          t.database,
          sql`SELECT id FROM ${tables(t.database).member} WHERE group_id = ${groupId}`,
        )
      )?.id ?? '';
  });
  afterAll(async () => t.close());

  it('removes a comment deleted 30 days ago, leaving a tombstone a device learns from, and keeps one deleted since', async () => {
    const away = await device(t.ada);
    const here = await device(t.ada);
    const expenseId = crypto.randomUUID();
    const row = expenseRow(
      {
        sealed,
        amount: toMinor(100),
        currency: 'EUR',
        date: '2026-11-01',
        category: 'general',
        method: 'equal',
        payers: [{ memberId: member, amount: toMinor(100) }],
        split: [{ memberId: member, units: null }],
      },
      [member],
    );
    if (!row.ok) throw new Error('fixture');
    await here.client.sync();
    await here.client.commit(addExpense({ mutationId: mid(), groupId, expenseId, row: row.value }));
    const [old, recent] = [crypto.randomUUID(), crypto.randomUUID()];
    for (const commentId of [old, recent])
      await here.client.commit(
        addComment({
          mutationId: mid(),
          groupId,
          commentId,
          subject: 'expense',
          subjectId: expenseId,
          sealed,
        }),
      );
    await here.client.sync();
    await away.client.sync();
    for (const commentId of [old, recent])
      await here.client.commit(deleteComment({ mutationId: mid(), groupId, commentId }));
    await here.client.sync();
    const now = Date.now();
    await dbRun(
      t.database,
      sql`UPDATE ${tables(t.database).comment} SET deleted_at = ${now - COMMENTS_AFTER_MS - DAY} WHERE id = ${old}`,
    );

    expect(await prune(t.database, now)).toEqual({ comments: 1, tombstones: 0, mutations: 0 });
    expect(await count(tables(t.database).comment, sql`id = ${old}`)).toBe(0);
    expect(
      await count(tables(t.database).tombstone, sql`id = ${old} AND row_table = 'comment'`),
    ).toBe(1);
    // A second run finds nothing left; two at once remove nothing twice.
    expect(await prune(t.database, now)).toEqual({ comments: 0, tombstones: 0, mutations: 0 });
    expect(await Promise.all([prune(t.database, now), prune(t.database, now)])).toEqual([
      { comments: 0, tombstones: 0, mutations: 0 },
      { comments: 0, tombstones: 0, mutations: 0 },
    ]);

    // The device that was not here learns of the removal from the tombstone, and of the other deletion as a row.
    await away.client.sync();
    expect((await view(away.db)).comments).toEqual([`${recent} deleted`]);
    await here.client.sync();
    expect(await view(here.db)).toEqual(await view(away.db));
  });

  it('forgets tombstones and applied mutations after 90 days, and a device away longer resyncs to the same rows as a fresh one', async () => {
    const away = await device(t.ada);
    await away.client.sync();
    const before = await view(away.db);
    // Something is removed while it is away: the recent comment, now 30 days deleted too.
    const now = Date.now();
    await dbRun(
      t.database,
      sql`UPDATE ${tables(t.database).comment} SET deleted_at = ${now - COMMENTS_AFTER_MS - DAY} WHERE group_id = ${groupId} AND deleted_at IS NOT NULL`,
    );
    expect((await prune(t.database, now)).comments).toBe(1);
    // And 90 days later its tombstone is forgotten, with every applied mutation of the time.
    const later = now + KEEP_MS + DAY;
    const pruned = await prune(t.database, later);
    expect(pruned.tombstones).toBeGreaterThanOrEqual(2);
    expect(pruned.mutations).toBeGreaterThan(0);
    expect(await count(tables(t.database).tombstone, sql`group_id = ${groupId}`)).toBe(0);
    const through = Number(
      (
        await dbGet<{ p: number }>(
          t.database,
          sql`SELECT pruned_through AS p FROM ${tables(t.database).grp} WHERE id = ${groupId}`,
        )
      )?.p,
    );
    expect(through).toBeGreaterThan(0);

    // The device that was away still shows the deleted comment; its next sync replaces its copy with the group afresh.
    expect(before.comments).toHaveLength(1);
    await away.client.sync();
    const fresh = await device(t.ada);
    await fresh.client.sync();
    expect(await view(away.db)).toEqual(await view(fresh.db));
    expect((await view(away.db)).comments).toEqual([]);
  });
});
