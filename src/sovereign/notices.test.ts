import { createFakeCore } from '@sovereignfs/sdk/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { addExpense, expenseRow } from '../actions';
import { balances } from '../balances';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { dbAll, dbGet, dbRun } from '../db/exec';
import * as postgresAuth from '../db/schema/postgres/auth';
import * as sqliteAuth from '../db/schema/sqlite/auth';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { opsHandler } from '../groups/api';
import { groupRows } from '../groups/lifecycle';
import { toMinor } from '../money/amount';
import { personOfAccount } from '../people/persons';
import { applyMutation } from '../sync/apply';
import { handleAccountDeleted, handleBackChannelLogout } from './http';
import { noticeDepsFor } from './server';

/**
 * Core's notices as the routes run them (DESIGN.md §14.3), on each database, against `@sovereignfs/sdk`'s fake core and the server's own wiring
 * (`noticeDepsFor`): a logout notice ends every session of the person and no one else's; an account-deleted notice leaves nothing personal of them
 * and every other member's balances as they were; a notice replayed after a restart (new wiring, the same database) is refused.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;

describe(`core's notices, as the routes run them (${leg})`, () => {
  let t: TwoAccounts;
  const core = createFakeCore();
  const sovereign = {
    issuer: core.url,
    clientId: core.credentials.clientId,
    clientSecret: 'unused',
  };
  const wiring = () =>
    noticeDepsFor({
      database: t.database,
      authDatabase: t.auth.database,
      sovereign,
      fetch: core.fetch,
    });
  const form = (field: string, token: string) =>
    new Request('https://tally.example.com/api/sovereign/notice', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ [field]: token }).toString(),
    });
  const auth = () => (t.auth.database.dialect === 'postgres' ? postgresAuth : sqliteAuth);
  const sessionsOf = async (accountId: string) =>
    Number(
      (
        await dbGet<{ n: number }>(
          t.auth.database,
          sql`SELECT COUNT(*) AS n FROM ${auth().session} WHERE user_id = ${accountId}`,
        )
      )?.n,
    );

  beforeAll(async () => {
    t = await twoAccounts();
    // Ada's account is linked to core as `core-ada`, as signing in through core leaves it.
    await dbRun(
      t.auth.database,
      sql`INSERT INTO ${auth().account} (id, account_id, provider_id, user_id, created_at, updated_at)
          VALUES (${crypto.randomUUID()}, 'core-ada', 'sovereign', ${t.ada.id}, ${new Date()}, ${new Date()})`,
    );
  });
  afterAll(async () => t.close());

  it('ends every session of the person a logout notice names, and no one else’s, and refuses it replayed after a restart', async () => {
    await t.as(t.ada).post('/api/auth/sign-in/email', {
      email: t.ada.email,
      password: 'a password long enough to be one',
    });
    expect(await sessionsOf(t.ada.id)).toBeGreaterThan(0);
    const graceBefore = await sessionsOf(t.grace.id);
    const token = await core.logoutToken({ sub: 'core-ada', sid: 's1' });
    expect((await handleBackChannelLogout(form('logout_token', token), wiring())).status).toBe(200);
    expect(await sessionsOf(t.ada.id)).toBe(0);
    expect(await sessionsOf(t.grace.id)).toBe(graceBefore);
    // A restart: the wiring made anew, the same database. The notice was seen.
    expect((await handleBackChannelLogout(form('logout_token', token), wiring())).status).toBe(400);
  });

  it('deletes the person an account-deleted notice names, leaving the others’ balances as they were', async () => {
    // A group of Ada's and Grace's with an expense Ada paid: Grace owes her.
    const groupId = crypto.randomUUID();
    const sealed = await sealRow({ name: 'Lisbon' }, await importGroupKey(newGroupKey()), 1, {
      group: 'g',
      table: 'grp',
      row: 'g',
    });
    // Sessions again, for the ops (the logout above ended Ada's).
    await t.as(t.ada).post('/api/auth/sign-in/email', {
      email: t.ada.email,
      password: 'a password long enough to be one',
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
    // Grace's person is made at her first request, as the app makes it.
    await ops(
      t.request(t.grace, '/api/ops', {
        method: 'POST',
        body: { op: 'group.read', groupId: crypto.randomUUID() },
      }),
    );
    const db = tables(t.database);
    const adaPerson = (await personOfAccount(t.database, t.ada.id))?.id ?? '';
    const gracePerson = (await personOfAccount(t.database, t.grace.id))?.id ?? '';
    const adaMember =
      (
        await dbGet<{ id: string }>(
          t.database,
          sql`SELECT id FROM ${db.member} WHERE group_id = ${groupId}`,
        )
      )?.id ?? '';
    const graceMember = crypto.randomUUID();
    await dbRun(
      t.database,
      sql`INSERT INTO ${db.member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
          VALUES (${graceMember}, ${groupId}, ${gracePerson}, 'member', 'all', NULL, ${Date.now() + 5}, NULL, 1)`,
    );
    const row = expenseRow(
      {
        sealed,
        amount: toMinor(3_000),
        currency: 'EUR',
        date: '2026-11-02',
        category: 'general',
        method: 'equal',
        payers: [{ memberId: adaMember, amount: toMinor(3_000) }],
        split: [adaMember, graceMember].map((memberId) => ({ memberId, units: null })),
      },
      [adaMember, graceMember],
    );
    if (!row.ok) throw new Error(row.refusal.code);
    const applied = await applyMutation(
      t.database,
      { accountId: t.ada.id, personId: adaPerson },
      addExpense({
        mutationId: crypto.randomUUID(),
        groupId,
        expenseId: crypto.randomUUID(),
        row: row.value,
      }),
    );
    expect(applied).toMatchObject({ status: 'applied' });
    const before = await groupRows(t.database, groupId);
    const graceBefore = balances(before.rows, before.order).get('EUR')?.get(graceMember);
    expect(graceBefore).toBe(-1_500);

    const token = await core.accountDeletedToken({ sub: 'core-ada' });
    expect(
      (await handleAccountDeleted(form('account_deleted_token', token), wiring())).status,
    ).toBe(200);

    // Nothing personal of Ada: her name alone, on the shared record.
    expect(
      await dbGet(
        t.database,
        sql`SELECT account_id AS "accountId", email, deleted_at IS NOT NULL AS gone FROM ${db.person} WHERE id = ${adaPerson}`,
      ),
    ).toMatchObject({
      accountId: null,
      email: null,
    });
    expect(
      await dbAll(t.auth.database, sql`SELECT id FROM ${auth().user} WHERE id = ${t.ada.id}`),
    ).toEqual([]);
    const after = await groupRows(t.database, groupId);
    expect(balances(after.rows, after.order).get('EUR')?.get(graceMember)).toBe(graceBefore);
    // Sent again with a new token, as core retries: a person nobody here knows is done, and answered 200.
    expect(
      (
        await handleAccountDeleted(
          form('account_deleted_token', await core.accountDeletedToken({ sub: 'core-ada' })),
          wiring(),
        )
      ).status,
    ).toBe(200);
  });
});
