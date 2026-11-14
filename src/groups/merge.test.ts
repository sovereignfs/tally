import 'fake-indexeddb/auto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type Person, type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { addExpense, addPayment, expenseRow } from '../actions';
import { type Balances, balances } from '../balances';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { dbAll, dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import type { Limiter } from '../limits/rate';
import { openLocal } from '../local/db';
import { readGroupRows } from '../local/store';
import { toMinor } from '../money/amount';
import { type SplitMethod, checkShares } from '../money/split';
import { personOfAccount } from '../people/persons';
import { type Actor, applyMutation } from '../sync/apply';
import { SyncClient, type Transport } from '../sync/client';
import { syncHandler } from '../sync/endpoint';
import type { SyncResponse } from '../sync/format';
import { opsHandler } from './api';
import { groupRows } from './lifecycle';

/**
 * Merging a placeholder into a member (DESIGN.md §7.2) over `POST /api/ops`, on each database: every balance afterwards is what it was with the two
 * added together, every expense and payment touched has its revision, the stored shares stay what their method gives, and a device that was offline
 * during the merge ends with the merged rows. Only an owner merges, only a placeholder, only into someone else still in the group.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;
const m = (value: number) => toMinor(value);

describe(`merging a placeholder (${leg})`, () => {
  let t: TwoAccounts;
  let ops: (request: Request) => Promise<Response>;
  let sync: (request: Request) => Promise<Response>;
  let sealed = '';
  let ada: Actor;
  let grace: Actor;
  let n = 0;
  const limiter: Limiter = { take: async () => ({ ok: true }) };
  const mid = () => `mutation-${++n}-${crypto.randomUUID().slice(0, 8)}`;
  const call = (who: Person, body: Record<string, unknown>) =>
    ops(t.request(who, '/api/ops', { method: 'POST', body }));
  const db = () => tables(t.database);

  /** A group of Ada's (owner) with Grace as a member and Sam, a placeholder (with an email); their member ids. */
  async function group() {
    const groupId = crypto.randomUUID();
    const made = await call(t.ada, {
      op: 'group.create',
      groupId,
      sealed,
      color: '#2563eb',
      defaultCurrency: 'EUR',
      keyWrap: WRAP,
    });
    expect(made.status).toBe(201);
    const ids = {
      groupId,
      ada:
        (
          await dbGet<{ id: string }>(
            t.database,
            sql`SELECT id FROM ${db().member} WHERE group_id = ${groupId}`,
          )
        )?.id ?? '',
      grace: crypto.randomUUID(),
      sam: crypto.randomUUID(),
      samPerson: crypto.randomUUID(),
    };
    await dbRun(
      t.database,
      sql`INSERT INTO ${db().person} (id, name, email, created_at, updated_at) VALUES (${ids.samPerson}, 'Sam', 'sam@example.com', 1, 1)`,
    );
    for (const [id, personId, role, at] of [
      [ids.grace, grace.personId, 'member', 2],
      [ids.sam, ids.samPerson, null, 3],
    ] as const)
      await dbRun(
        t.database,
        sql`INSERT INTO ${db().member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
            VALUES (${id}, ${groupId}, ${personId}, ${role}, 'all', NULL, ${Date.now() + at}, NULL, 1)`,
      );
    return ids;
  }

  async function expense(
    groupId: string,
    members: string[],
    payers: { memberId: string; amount: number }[],
    split: { memberId: string; units: number | null }[],
    method: SplitMethod = 'equal',
  ) {
    const amount = payers.reduce((sum, p) => sum + p.amount, 0);
    const row = expenseRow(
      {
        sealed,
        amount: m(amount),
        currency: 'EUR',
        date: '2026-11-02',
        category: 'general',
        method,
        payers: payers.map((p) => ({ memberId: p.memberId, amount: m(p.amount) })),
        split,
      },
      members,
    );
    if (!row.ok) throw new Error(row.refusal.code);
    const expenseId = crypto.randomUUID();
    expect(
      (
        await applyMutation(
          t.database,
          ada,
          addExpense({ mutationId: mid(), groupId, expenseId, row: row.value }),
        )
      ).status,
    ).toBe('applied');
    return expenseId;
  }
  async function pay(groupId: string, from: string, to: string, amount: number, currency = 'EUR') {
    const paymentId = crypto.randomUUID();
    expect(
      (
        await applyMutation(
          t.database,
          ada,
          addPayment({
            mutationId: mid(),
            groupId,
            paymentId,
            row: {
              sealed: null,
              fromMemberId: from,
              toMemberId: to,
              amount: m(amount),
              currency,
              date: '2026-11-03',
            },
          }),
        )
      ).status,
    ).toBe('applied');
    return paymentId;
  }
  const table = async (groupId: string): Promise<Balances> => {
    const { rows, order } = await groupRows(t.database, groupId);
    return balances(rows, order);
  };
  const of = (b: Balances, currency: string, memberId: string) =>
    Number(b.get(currency)?.get(memberId) ?? 0);

  async function device(who: Person) {
    const local = await openLocal(who.id, `tally-test-merge-${crypto.randomUUID()}`);
    const state = { offline: false };
    const transport: Transport = async (request) => {
      if (state.offline) return { kind: 'offline' };
      const reply = await sync(t.request(who, '/api/sync', { method: 'POST', body: request }));
      if (reply.status !== 200) return { kind: 'status', status: reply.status };
      return { kind: 'answer', answer: (await reply.json()) as SyncResponse };
    };
    const personId = (await personOfAccount(t.database, who.id))?.id ?? '';
    return { local, state, client: new SyncClient({ db: local, transport, personId }) };
  }

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
      await call(who, { op: 'group.read', groupId: crypto.randomUUID() });
    sealed = await sealRow({ name: 'Lisbon' }, await importGroupKey(newGroupKey()), 1, {
      group: 'g',
      table: 'grp',
      row: 'g',
    });
    ada = {
      accountId: t.ada.id,
      personId: (await personOfAccount(t.database, t.ada.id))?.id ?? '',
    };
    grace = {
      accountId: t.grace.id,
      personId: (await personOfAccount(t.database, t.grace.id))?.id ?? '',
    };
  });
  afterAll(async () => t.close());

  it('moves everything of the placeholder to the member: every balance is the two added together, each row with its revision', async () => {
    const g = await group();
    const everyone = [g.ada, g.grace, g.sam];
    // Ada pays 100.00 split equally among the three (one cent left over), Sam pays 20.00 for Grace and Sam, Grace and Sam pay 9.00 for Ada and Sam by
    // shares 2:1; Sam paid Grace 5.00 (a payment between the two), Sam paid Ada 3.00, and Grace paid Ada ¥700.
    const onAll = await expense(
      g.groupId,
      everyone,
      [{ memberId: g.ada, amount: 10_000 }],
      everyone.map((memberId) => ({ memberId, units: null })),
    );
    const both = await expense(
      g.groupId,
      everyone,
      [{ memberId: g.sam, amount: 2_000 }],
      [g.grace, g.sam].map((memberId) => ({ memberId, units: null })),
    );
    const byShares = await expense(
      g.groupId,
      everyone,
      [
        { memberId: g.grace, amount: 400 },
        { memberId: g.sam, amount: 500 },
      ],
      [
        { memberId: g.ada, units: 2 },
        { memberId: g.sam, units: 1 },
      ],
      'shares',
    );
    const untouched = await expense(
      g.groupId,
      everyone,
      [{ memberId: g.ada, amount: 1_000 }],
      [g.ada, g.grace].map((memberId) => ({ memberId, units: null })),
    );
    const between = await pay(g.groupId, g.sam, g.grace, 500);
    const toAda = await pay(g.groupId, g.sam, g.ada, 300);
    await pay(g.groupId, g.grace, g.ada, 700, 'JPY');

    const before = await table(g.groupId);
    const seqBefore = Number(
      (
        await dbGet<{ seq: number }>(
          t.database,
          sql`SELECT seq FROM ${db().grp} WHERE id = ${g.groupId}`,
        )
      )?.seq,
    );

    const reply = await call(t.ada, {
      op: 'member.merge',
      groupId: g.groupId,
      memberId: g.sam,
      intoMemberId: g.grace,
    });
    expect(reply.status).toBe(200);

    const after = await table(g.groupId);
    for (const currency of ['EUR', 'JPY']) {
      expect(of(after, currency, g.ada), currency).toBe(of(before, currency, g.ada));
      expect(of(after, currency, g.grace), currency).toBe(
        of(before, currency, g.grace) + of(before, currency, g.sam),
      );
      expect(of(after, currency, g.sam), currency).toBe(0);
    }

    // Nothing of the group names Sam any more.
    for (const [name, query] of [
      [
        'payers',
        sql`SELECT COUNT(*) AS n FROM ${db().expensePayer} WHERE group_id = ${g.groupId} AND member_id = ${g.sam}`,
      ],
      [
        'shares',
        sql`SELECT COUNT(*) AS n FROM ${db().expenseShare} WHERE group_id = ${g.groupId} AND member_id = ${g.sam}`,
      ],
      [
        'payments',
        sql`SELECT COUNT(*) AS n FROM ${db().payment} WHERE group_id = ${g.groupId} AND (from_member_id = ${g.sam} OR to_member_id = ${g.sam})`,
      ],
    ] as const)
      expect(Number((await dbGet<{ n: number }>(t.database, query))?.n), name).toBe(0);

    // Every stored split is still exactly what its method and units give, in the group's order.
    const { order } = await groupRows(t.database, g.groupId);
    const stored = await dbAll<{
      id: string;
      amount: number;
      method: SplitMethod;
      version: number;
    }>(
      t.database,
      sql`SELECT id, amount, method, version FROM ${db().expense} WHERE group_id = ${g.groupId}`,
    );
    for (const e of stored) {
      const shares = await dbAll<{ memberId: string; amount: number; units: number | null }>(
        t.database,
        sql`SELECT member_id AS "memberId", amount, units FROM ${db().expenseShare} WHERE expense_id = ${e.id}`,
      );
      expect(() =>
        checkShares(
          m(Number(e.amount)),
          e.method,
          shares.map((s) => ({
            memberId: s.memberId,
            amount: m(Number(s.amount)),
            units: s.units === null ? null : Number(s.units),
          })),
          order,
        ),
      ).not.toThrow();
    }
    const versions = new Map(stored.map((e) => [e.id, Number(e.version)]));
    expect(versions.get(onAll)).toBe(2);
    expect(versions.get(both)).toBe(2);
    expect(versions.get(byShares)).toBe(2);
    expect(versions.get(untouched)).toBe(1);
    // Grace and Sam both on one: split by amounts now, Grace's share the two added.
    expect(stored.find((e) => e.id === both)?.method).toBe('amounts');
    expect(
      await dbAll(
        t.database,
        sql`SELECT member_id AS "memberId", amount FROM ${db().expensePayer} WHERE expense_id = ${byShares}`,
      ),
    ).toEqual([{ memberId: g.grace, amount: 900 }]);

    // The payment between the two is deleted, the other moved; each with its revision.
    const payments = await dbAll<{
      id: string;
      fromId: string;
      toId: string;
      deletedAt: number | null;
    }>(
      t.database,
      sql`SELECT id, from_member_id AS "fromId", to_member_id AS "toId", deleted_at AS "deletedAt" FROM ${db().payment} WHERE id IN (${between}, ${toAda})`,
    );
    expect(payments.find((p) => p.id === between)?.deletedAt).not.toBeNull();
    expect(payments.find((p) => p.id === toAda)).toMatchObject({
      fromId: g.grace,
      toId: g.ada,
      deletedAt: null,
    });
    const revisions = await dbAll<{ subjectId: string; kind: string }>(
      t.database,
      sql`SELECT subject_id AS "subjectId", kind FROM ${db().revision} WHERE group_id = ${g.groupId} AND version = 2`,
    );
    expect(new Map(revisions.map((r) => [r.subjectId, r.kind]))).toEqual(
      new Map([
        [onAll, 'edited'],
        [both, 'edited'],
        [byShares, 'edited'],
        [between, 'deleted'],
        [toAda, 'edited'],
      ]),
    );

    // Sam's membership ended, the group moved on once, the activity said, and Sam, in no other group, keeps no email.
    expect(
      await dbGet(
        t.database,
        sql`SELECT left_at IS NOT NULL AS gone FROM ${db().member} WHERE id = ${g.sam}`,
      ),
    ).toMatchObject({ gone: expect.anything() });
    expect(
      Number(
        (
          await dbGet<{ seq: number }>(
            t.database,
            sql`SELECT seq FROM ${db().grp} WHERE id = ${g.groupId}`,
          )
        )?.seq,
      ),
    ).toBe(seqBefore + 1);
    expect(
      await dbGet(
        t.database,
        sql`SELECT details FROM ${db().activity} WHERE group_id = ${g.groupId} AND kind = 'member_merged'`,
      ),
    ).toBeDefined();
    expect(
      await dbGet(t.database, sql`SELECT email FROM ${db().person} WHERE id = ${g.samPerson}`),
    ).toEqual({ email: null });
  });

  it('is an owner’s, of a placeholder only, into someone else still in the group; anything else is not found', async () => {
    const g = await group();
    const merge = (who: Person, memberId: string, intoMemberId: string) =>
      call(who, { op: 'member.merge', groupId: g.groupId, memberId, intoMemberId }).then(
        (r) => r.status,
      );
    expect(await merge(t.grace, g.sam, g.grace)).toBe(404);
    expect(await merge(t.ada, g.grace, g.ada)).toBe(404);
    expect(await merge(t.ada, g.sam, g.sam)).toBe(404);
    expect(await merge(t.ada, g.sam, crypto.randomUUID())).toBe(404);
    const other = await group();
    expect(await merge(t.ada, g.sam, other.grace)).toBe(404);
    await dbRun(t.database, sql`UPDATE ${db().member} SET left_at = 1 WHERE id = ${g.grace}`);
    expect(await merge(t.ada, g.sam, g.grace)).toBe(404);
    // Nothing was written by any of them.
    expect(
      await dbGet(
        t.database,
        sql`SELECT left_at AS "leftAt" FROM ${db().member} WHERE id = ${g.sam}`,
      ),
    ).toEqual({ leftAt: null });
    expect(
      await dbGet(
        t.database,
        sql`SELECT kind FROM ${db().activity} WHERE group_id = ${g.groupId} AND kind = 'member_merged'`,
      ),
    ).toBeUndefined();
  });

  it('a device offline during the merge ends with the merged rows', async () => {
    const g = await group();
    const everyone = [g.ada, g.grace, g.sam];
    const graceDevice = await device(t.grace);
    const adaDevice = await device(t.ada);
    await expense(
      g.groupId,
      everyone,
      [{ memberId: g.sam, amount: 3_000 }],
      everyone.map((memberId) => ({ memberId, units: null })),
    );
    await pay(g.groupId, g.sam, g.ada, 400);
    expect(await graceDevice.client.sync()).toEqual({ status: 'synced' });
    graceDevice.state.offline = true;

    expect(
      (
        await call(t.ada, {
          op: 'member.merge',
          groupId: g.groupId,
          memberId: g.sam,
          intoMemberId: g.grace,
        })
      ).status,
    ).toBe(200);
    expect(await graceDevice.client.sync()).toEqual({ status: 'offline' });

    graceDevice.state.offline = false;
    expect(await graceDevice.client.sync()).toEqual({ status: 'synced' });
    expect(await adaDevice.client.sync()).toEqual({ status: 'synced' });
    const view = async (local: Awaited<ReturnType<typeof device>>['local']) => {
      const rows = await readGroupRows(local, g.groupId);
      return {
        expenses: rows.expenses
          .map((e) => ({ id: e.id, version: e.version, payers: e.payers, shares: e.shares }))
          .sort((a, b) => (a.id < b.id ? -1 : 1)),
        payments: rows.payments
          .map((p) => ({ id: p.id, from: p.fromMemberId, to: p.toMemberId, version: p.version }))
          .sort((a, b) => (a.id < b.id ? -1 : 1)),
        sam: rows.members.find((member) => member.id === g.sam)?.leftAt ?? null,
      };
    };
    const graces = await view(graceDevice.local);
    expect(graces).toEqual(await view(adaDevice.local));
    expect(graces.sam).not.toBeNull();
    expect(graces.expenses[0]?.payers).toEqual([{ memberId: g.grace, amount: 3_000 }]);
    expect(graces.expenses[0]?.shares.map((s) => s.memberId).sort()).toEqual(
      [g.ada, g.grace].sort(),
    );
    expect(graces.payments[0]).toMatchObject({ from: g.grace, to: g.ada, version: 2 });
  });
});
