import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type Person, type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { addComment, addExpense, addPayment, expenseRow, type Mutation } from '../actions';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { opsHandler } from '../groups/api';
import type { Limiter } from '../limits/rate';
import { toMinor } from '../money/amount';
import { personOfAccount } from '../people/persons';
import { type SyncDeps, syncHandler } from './endpoint';
import { LIMITS, PROTOCOL_VERSION, type SyncResponse } from './format';

/**
 * `POST /api/sync` (DESIGN.md §11.3) with two real accounts, on each database: a snapshot from zero, a cursor that gets only what is new, pages that
 * end on a change's boundary, a group left between two syncs named gone, a lost answer retried applying nothing twice, and nothing of Ada's group
 * reaching Grace, whatever she sends.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;
const m = (value: number) => toMinor(value);

describe(`the sync endpoint (${leg})`, () => {
  let t: TwoAccounts;
  let ops: (request: Request) => Promise<Response>;
  let sync: (request: Request) => Promise<Response>;
  let deps: SyncDeps;
  let sealed = '';
  const groupId = crypto.randomUUID();
  let ada = '';
  let sam = '';
  let n = 0;
  const mid = () => `mutation-${++n}-${crypto.randomUUID().slice(0, 8)}`;
  let allow = true;
  const limiter: Limiter = {
    take: async () => (allow ? { ok: true } : { ok: false, retryAfterMs: 4_000 }),
  };

  const call = (who: Person | null, body: unknown) =>
    sync(t.request(who, '/api/sync', { method: 'POST', body }));
  async function send(
    who: Person,
    cursors: Record<string, number>,
    mutations: unknown[] = [],
    extra: Record<string, unknown> = {},
  ) {
    const reply = await call(who, { protocol: PROTOCOL_VERSION, mutations, cursors, ...extra });
    expect(reply.status).toBe(200);
    return (await reply.json()) as SyncResponse;
  }
  const dinner = (amount: number) => {
    const row = expenseRow(
      {
        sealed,
        amount: m(amount),
        currency: 'EUR',
        date: '2026-11-02',
        category: 'eating_out',
        method: 'equal',
        payers: [{ memberId: ada, amount: m(amount) }],
        split: [ada, sam].map((memberId) => ({ memberId, units: null })),
      },
      [ada, sam],
    );
    if (!row.ok) throw new Error(row.refusal.code);
    return row.value;
  };
  const expenseMutation = (amount = 1_000, expenseId = crypto.randomUUID()): Mutation =>
    addExpense({ mutationId: mid(), groupId, expenseId, row: dinner(amount) });

  beforeAll(async () => {
    t = await twoAccounts();
    ops = accountRoute(
      opsHandler(async () => t.database),
      t.deps,
    );
    deps = { database: t.database, limiter, now: Date.now };
    sync = accountRoute(
      syncHandler(async () => deps),
      t.deps,
    );
    for (const who of [t.ada, t.grace])
      await ops(
        t.request(who, '/api/ops', { method: 'POST', body: { op: 'group.read', groupId } }),
      );
    sealed = await sealRow({ name: 'Lisbon' }, await importGroupKey(newGroupKey()), 1, {
      group: groupId,
      table: 'grp',
      row: groupId,
    });
    const made = await ops(
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
    expect(made.status).toBe(201);
    ada =
      (
        await dbGet<{ id: string }>(
          t.database,
          sql`SELECT id FROM ${tables(t.database).member} WHERE group_id = ${groupId}`,
        )
      )?.id ?? '';
    sam = crypto.randomUUID();
    const samPerson = crypto.randomUUID();
    await dbRun(
      t.database,
      sql`INSERT INTO ${tables(t.database).person} (id, name, email, created_at, updated_at) VALUES (${samPerson}, 'Sam', 'sam@example.com', 1, 1)`,
    );
    // Sam joins in a change of its own: the group's seq moves on, and his row carries it.
    const seq = Number(
      (
        await dbGet<{ seq: number }>(
          t.database,
          sql`UPDATE ${tables(t.database).grp} SET seq = seq + 1 WHERE id = ${groupId} RETURNING seq`,
        )
      )?.seq,
    );
    await dbRun(
      t.database,
      sql`INSERT INTO ${tables(t.database).member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
          VALUES (${sam}, ${groupId}, ${samPerson}, NULL, 'all', NULL, ${Date.now() + 1}, NULL, ${seq})`,
    );
  });
  afterAll(async () => t.close());

  it('applies the outbox in order and answers a device starting at zero with each group whole', async () => {
    const expenseId = crypto.randomUUID();
    const answer = await send(t.ada, {}, [
      expenseMutation(1_000, expenseId),
      addPayment({
        mutationId: mid(),
        groupId,
        paymentId: crypto.randomUUID(),
        row: {
          sealed: null,
          fromMemberId: sam,
          toMemberId: ada,
          amount: m(500),
          currency: 'EUR',
          date: '2026-11-03',
        },
      }),
      addComment({
        mutationId: mid(),
        groupId,
        commentId: crypto.randomUUID(),
        subject: 'expense',
        subjectId: expenseId,
        sealed,
      }),
    ]);
    expect(answer.results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied']);
    const mine = answer.groups.find((g) => g.group.id === groupId);
    expect(mine?.group).toMatchObject({
      sealed,
      defaultCurrency: 'EUR',
      keyEpoch: 1,
      closedAt: null,
    });
    expect(mine?.members.map((x) => x.name).sort()).toEqual(['Ada', 'Sam']);
    // Names only: no email reaches a device's store.
    expect(JSON.stringify(mine?.members)).not.toContain('@');
    expect(mine?.members.find((x) => x.id === sam)).toMatchObject({
      placeholder: true,
      leftTally: false,
    });
    expect(mine?.expenses).toHaveLength(1);
    expect(mine?.expenses[0]).toMatchObject({ id: expenseId, amount: 1_000, version: 1 });
    expect(mine?.expenses[0]?.payers).toEqual([{ memberId: ada, amount: 1_000 }]);
    expect(mine?.expenses[0]?.shares).toHaveLength(2);
    expect(mine?.payments).toHaveLength(1);
    expect(mine?.comments).toHaveLength(1);
    expect(mine?.more).toBe(false);
    expect(mine?.cursor).toBe(mine?.group.seq);
    expect(answer.keys.wraps).toEqual([{ groupId, epoch: 1, wrapped: WRAP }]);
    expect(answer.gone).toEqual([]);
  });

  it('gives a cursor only what is new, and nothing when nothing is', async () => {
    const first = await send(t.ada, {});
    const cursor = first.groups.find((g) => g.group.id === groupId)?.cursor ?? 0;
    const idle = await send(t.ada, { [groupId]: cursor });
    expect(idle.groups.find((g) => g.group.id === groupId)).toMatchObject({
      expenses: [],
      payments: [],
      members: [],
      cursor,
    });
    const added = crypto.randomUUID();
    const next = await send(t.ada, { [groupId]: cursor }, [expenseMutation(2_000, added)]);
    const changes = next.groups.find((g) => g.group.id === groupId);
    expect(changes?.expenses.map((e) => e.id)).toEqual([added]);
    expect(changes?.members).toEqual([]);
    expect(changes?.cursor).toBeGreaterThan(cursor);
  });

  it('pages at seq boundaries, and the pages together are the snapshot', async () => {
    // More rows than a page reads of any one table.
    await send(
      t.ada,
      {},
      [1, 2, 3, 4, 5, 6].map((k) => expenseMutation(100 * k)),
    );
    const whole = (await send(t.ada, {})).groups.find((g) => g.group.id === groupId);
    deps = { ...deps, rowsPerRequest: 2 };
    try {
      let cursor = 0;
      const seen: number[] = [];
      for (let page = 0; page < 50; page++) {
        const changes = (await send(t.ada, { [groupId]: cursor })).groups.find(
          (g) => g.group.id === groupId,
        );
        if (!changes) throw new Error('missing');
        const rows = [
          ...changes.members,
          ...changes.expenses,
          ...changes.payments,
          ...changes.comments,
        ];
        for (const row of rows) {
          // Never a seq the page before already ended on.
          expect(row.seq).toBeGreaterThan(cursor);
          seen.push(row.seq);
        }
        cursor = changes.cursor;
        if (!changes.more) break;
      }
      const all = whole
        ? [...whole.members, ...whole.expenses, ...whole.payments, ...whole.comments].map(
            (r) => r.seq,
          )
        : [];
      expect(seen.sort((a, b) => a - b)).toEqual(all.sort((a, b) => a - b));
      expect(cursor).toBe(whole?.group.seq);
    } finally {
      deps = { ...deps, rowsPerRequest: undefined };
    }
  });

  it('applies nothing twice when a lost answer is retried, and answers a refused mutation without refusing the rest', async () => {
    const mutation = expenseMutation(3_000);
    const first = await send(t.ada, {}, [mutation]);
    const count = async () =>
      Number(
        (
          await dbGet<{ n: number }>(
            t.database,
            sql`SELECT COUNT(*) AS n FROM ${tables(t.database).expense}`,
          )
        )?.n,
      );
    const before = await count();
    const again = await send(t.ada, {}, [mutation]);
    expect(again.results).toEqual(first.results);
    expect(await count()).toBe(before);

    const bad = expenseMutation(4_000);
    const change = bad.changes[0];
    if (change?.table !== 'expense' || change.op !== 'put') throw new Error('fixture');
    change.row = { ...change.row, currency: 'XXQ' };
    const mixed = await send(t.ada, {}, [bad, expenseMutation(5_000), { nonsense: true }]);
    expect(mixed.results).toEqual([
      { mutationId: bad.mutationId, status: 'refused', refusal: { code: 'currency' } },
      expect.objectContaining({ status: 'applied' }),
      { mutationId: null, status: 'refused', refusal: { code: 'malformed' } },
    ]);
  });

  it('names a group the account left between two syncs as gone, and its rows stop', async () => {
    await dbRun(
      t.database,
      sql`INSERT INTO ${tables(t.database).member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
      VALUES (${crypto.randomUUID()}, ${groupId}, ${(await personOfAccount(t.database, t.grace.id))?.id ?? ''}, 'member', 'all', NULL, ${Date.now() + 5}, NULL, 1)`,
    );
    const inIt = await send(t.grace, {});
    expect(inIt.groups.map((g) => g.group.id)).toContain(groupId);
    const cursor = inIt.groups.find((g) => g.group.id === groupId)?.cursor ?? 0;
    await dbRun(
      t.database,
      sql`UPDATE ${tables(t.database).member} SET left_at = 1 WHERE group_id = ${groupId} AND person_id = ${(await personOfAccount(t.database, t.grace.id))?.id ?? ''}`,
    );
    await send(t.ada, {}, [expenseMutation(6_000)]);
    const after = await send(t.grace, { [groupId]: cursor });
    expect(after.gone).toEqual([groupId]);
    expect(after.groups.map((g) => g.group.id)).not.toContain(groupId);
    expect(after.keys.wraps.filter((w) => w.groupId === groupId)).toEqual([]);
  });

  it('gives Grace nothing of a group she is not in, and applies nothing she sends for it', async () => {
    const count = async () =>
      Number(
        (
          await dbGet<{ n: number }>(
            t.database,
            sql`SELECT COUNT(*) AS n FROM ${tables(t.database).expense} WHERE group_id = ${groupId}`,
          )
        )?.n,
      );
    const before = await count();
    const answer = await send(t.grace, { [groupId]: 0 }, [expenseMutation(7_000)]);
    expect(answer.results[0]).toMatchObject({
      status: 'refused',
      refusal: { code: 'not_in_group' },
    });
    expect(answer.groups.map((g) => g.group.id)).not.toContain(groupId);
    expect(await count()).toBe(before);
  });

  it('refuses a request that is not one, an old device, too much, too often, and no session', async () => {
    expect(
      (await call(t.ada, { protocol: PROTOCOL_VERSION, mutations: [], cursors: {}, extra: 1 }))
        .status,
    ).toBe(400);
    expect(
      (await call(t.ada, { protocol: PROTOCOL_VERSION, mutations: [], cursors: { [groupId]: -1 } }))
        .status,
    ).toBe(400);
    expect(
      (
        await call(t.ada, {
          protocol: PROTOCOL_VERSION,
          mutations: Array(LIMITS.mutationsPerRequest + 1).fill({}),
          cursors: {},
        })
      ).status,
    ).toBe(400);
    const old = await call(t.ada, { protocol: 0, mutations: [], cursors: {} });
    expect(old.status).toBe(426);
    expect(await old.json()).toEqual({ code: 'UPDATE_REQUIRED', protocol: PROTOCOL_VERSION });
    const huge = await sync(
      t.request(t.ada, '/api/sync', {
        method: 'POST',
        body: {
          protocol: PROTOCOL_VERSION,
          mutations: [],
          cursors: {},
          pad: 'x'.repeat(LIMITS.bodyBytes),
        },
      }),
    );
    expect(huge.status).toBe(413);
    allow = false;
    try {
      const limited = await call(t.ada, { protocol: PROTOCOL_VERSION, mutations: [], cursors: {} });
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBe('4');
    } finally {
      allow = true;
    }
    expect(
      (await call(null, { protocol: PROTOCOL_VERSION, mutations: [], cursors: {} })).status,
    ).toBe(401);
  });
});
