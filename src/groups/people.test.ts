import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type Person, type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { addExpense, expenseRow } from '../actions';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { dbGet } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { toMinor } from '../money/amount';
import { personOfAccount } from '../people/persons';
import { applyMutation } from '../sync/apply';
import { opsHandler } from './api';
import { EMAIL_LOOKUP } from './people';

/**
 * Adding people (DESIGN.md §6.2) over `POST /api/ops`, on each database: a placeholder by name can pay and share from the moment it is added; an exact
 * email adds its account, another makes a placeholder whose email only its adder sees; the lookup is limited with a sentence; someone not in the group
 * adds nobody; a placeholder is edited by whoever added it.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;

describe(`adding people (${leg})`, () => {
  let t: TwoAccounts;
  let ops: (request: Request) => Promise<Response>;
  let sealed = '';
  const groupId = crypto.randomUUID();
  const call = async (who: Person, body: Record<string, unknown>) => {
    const reply = await ops(t.request(who, '/api/ops', { method: 'POST', body }));
    return {
      status: reply.status,
      body: (await reply.json().catch(() => null)) as Record<string, unknown> | null,
    };
  };

  beforeAll(async () => {
    t = await twoAccounts();
    ops = accountRoute(
      opsHandler(async () => t.database),
      t.deps,
    );
    for (const who of [t.ada, t.grace]) await call(who, { op: 'group.read', groupId });
    sealed = await sealRow({ name: 'Lisbon' }, await importGroupKey(newGroupKey()), 1, {
      group: groupId,
      table: 'grp',
      row: groupId,
    });
    expect(
      (
        await call(t.ada, {
          op: 'group.create',
          groupId,
          sealed,
          color: '#2563eb',
          defaultCurrency: 'EUR',
          keyWrap: WRAP,
        })
      ).status,
    ).toBe(201);
  });
  afterAll(async () => t.close());

  it('adds a placeholder by name, who can pay and share from that moment', async () => {
    const added = await call(t.ada, { op: 'member.add', groupId, name: '  Sam  ' });
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ placeholder: true, email: null });
    const sam = String(added.body?.memberId);
    const ada =
      (
        await dbGet<{ id: string }>(
          t.database,
          sql`SELECT m.id FROM ${tables(t.database).member} m JOIN ${tables(t.database).person} p ON p.id = m.person_id WHERE m.group_id = ${groupId} AND p.account_id = ${t.ada.id}`,
        )
      )?.id ?? '';
    const order = [ada, sam];
    const expenseSealed = await sealRow(
      { description: 'x', note: null },
      await importGroupKey(newGroupKey()),
      1,
      { group: groupId, table: 'expense', row: 'x' },
    );
    const row = expenseRow(
      {
        sealed: expenseSealed,
        amount: toMinor(1_000),
        currency: 'EUR',
        date: '2026-11-14',
        category: 'general',
        method: 'equal',
        payers: [{ memberId: sam, amount: toMinor(1_000) }],
        split: order.map((memberId) => ({ memberId, units: null })),
      },
      order,
    );
    if (!row.ok) throw new Error('fixture');
    const ada_ = {
      accountId: t.ada.id,
      personId: (await personOfAccount(t.database, t.ada.id))?.id ?? '',
    };
    expect(
      (
        await applyMutation(
          t.database,
          ada_,
          addExpense({
            mutationId: crypto.randomUUID(),
            groupId,
            expenseId: crypto.randomUUID(),
            row: row.value,
          }),
        )
      ).status,
    ).toBe('applied');
    const name = await dbGet<{ name: string }>(
      t.database,
      sql`SELECT name FROM ${tables(t.database).person} WHERE id = ${String(added.body?.personId)}`,
    );
    expect(name?.name).toBe('Sam');
  });

  it('adds an account by its exact email, and refuses someone already in the group', async () => {
    const added = await call(t.ada, { op: 'member.add', groupId, email: ' GRACE@example.com ' });
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ placeholder: false, email: null });
    expect((await call(t.grace, { op: 'group.read', groupId })).status).toBe(200);
    const again = await call(t.ada, { op: 'member.add', groupId, email: 'grace@example.com' });
    expect(again).toMatchObject({
      status: 409,
      body: { code: 'already_member', message: 'They are in this group already.' },
    });
  });

  it('makes a placeholder of another email, which its adder sees and another member does not', async () => {
    const added = await call(t.ada, {
      op: 'member.add',
      groupId,
      email: 'lee@example.com',
      name: 'Lee',
    });
    expect(added.body).toMatchObject({ placeholder: true, email: 'lee@example.com' });
    const asAda = (await call(t.ada, { op: 'group.read', groupId })).body as {
      members: { name: string; email: string | null }[];
    };
    expect(asAda.members.find((m) => m.name === 'Lee')?.email).toBe('lee@example.com');
    const asGrace = (await call(t.grace, { op: 'group.read', groupId })).body as {
      members: { name: string; email: string | null }[];
    };
    expect(asGrace.members.find((m) => m.name === 'Lee')?.email).toBeNull();
  });

  it('is edited by whoever added it, and by nobody else who is not an owner', async () => {
    const lee = await dbGet<{ id: string }>(
      t.database,
      sql`SELECT id FROM ${tables(t.database).person} WHERE name = 'Lee' AND account_id IS NULL`,
    );
    expect(
      (await call(t.grace, { op: 'person.edit', personId: lee?.id, name: 'Leo' })).status,
    ).toBe(404);
    expect(
      (await call(t.ada, { op: 'person.edit', personId: lee?.id, name: 'Lee Chan' })).status,
    ).toBe(200);
    expect(
      (
        await dbGet<{ name: string }>(
          t.database,
          sql`SELECT name FROM ${tables(t.database).person} WHERE id = ${lee?.id ?? ''}`,
        )
      )?.name,
    ).toBe('Lee Chan');
  });

  it('adds nobody for someone not in the group, and limits looking up addresses with a sentence', async () => {
    const other = crypto.randomUUID();
    expect((await call(t.grace, { op: 'member.add', groupId: other, name: 'Nobody' })).status).toBe(
      404,
    );
    let last = { status: 0, body: null as Record<string, unknown> | null };
    for (let i = 0; i <= EMAIL_LOOKUP.limit; i++)
      last = await call(t.grace, { op: 'member.add', groupId, email: `p${i}@example.com` });
    expect(last).toMatchObject({ status: 429, body: { code: 'rate_limited' } });
    expect(String(last.body?.message)).toContain('Try again later');
  });
});
