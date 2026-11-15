import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestAuth, makeAuth } from '../src/auth/test-support';
import { derivePassword } from '../src/cipher/password';
import { unwrapWithSecret } from '../src/cipher/wrap';
import type { Database } from '../src/db/client';
import { dbAll, dbGet } from '../src/db/exec';
import { tables } from '../src/db/tables';
import { openStoreBesideAuth } from '../src/db/test-store';
import { testTarget } from '../src/db/test-support';
import { GROUPS, PEOPLE, SEED_PASSWORD, id, isLocal, removeSeed, runSeed } from './seed';

/**
 * The development seed (task 13.1), on each database: everything the epic lists, made through the app's own paths; the same on a second run, which
 * changes nothing; a seeded password that signs in and unlocks the account's key; `--reset` making it all again; and nothing but this machine.
 */
const { leg } = testTarget();
const URL_ = 'http://localhost:3004';

describe(`the development seed (${leg})`, () => {
  let auth: TestAuth;
  let app: Database;
  let closeStore: () => Promise<void>;
  const stores = () => ({ app, auth: auth.database });
  const t = () => tables(app);

  /** How many rows each table holds: what a second run must leave as it is. */
  const counts = async () => {
    const out: Record<string, number> = {};
    for (const [name, table] of Object.entries({
      grp: t().grp,
      member: t().member,
      person: t().person,
      expense: t().expense,
      expense_share: t().expenseShare,
      payment: t().payment,
      comment: t().comment,
      revision: t().revision,
      activity: t().activity,
      invitation: t().invitation,
      key_wrap: t().keyWrap,
      account_key: t().accountKey,
    }))
      out[name] = Number(
        (await dbGet<{ n: number }>(app, sql`SELECT COUNT(*) AS n FROM ${table}`))?.n,
      );
    return out;
  };

  beforeAll(async () => {
    auth = await makeAuth();
    const store = await openStoreBesideAuth();
    app = store.database;
    closeStore = () => store.close();
  });
  afterAll(async () => {
    await closeStore();
    await auth.close();
  });

  it('makes everything the epic lists, through the app’s own paths', async () => {
    await runSeed(stores(), URL_, auth.settings.secret);
    const lisbon = GROUPS.lisbon;
    const methods = await dbAll<{ method: string; currency: string }>(
      app,
      sql`SELECT DISTINCT method, currency FROM ${t().expense} WHERE group_id = ${lisbon}`,
    );
    expect(new Set(methods.map((r) => r.method))).toEqual(
      new Set(['equal', 'amounts', 'percentages', 'shares']),
    );
    expect(new Set(methods.map((r) => r.currency))).toEqual(new Set(['EUR', 'JPY']));
    // Several payers on one; a conflict in history; comments; a payment.
    expect(
      await dbGet<{ n: number }>(
        app,
        sql`SELECT COUNT(*) AS n FROM ${t().expensePayer} WHERE expense_id = ${id('expense:museum')}`,
      ),
    ).toMatchObject({ n: 2 });
    expect(
      await dbAll(
        app,
        sql`SELECT kind FROM ${t().revision} WHERE subject_id = ${id('expense:dinner')} AND kind = 'replaced'`,
      ),
    ).toHaveLength(1);
    expect(
      await dbAll(app, sql`SELECT id FROM ${t().comment} WHERE group_id = ${lisbon}`),
    ).toHaveLength(2);
    expect(
      await dbAll(app, sql`SELECT id FROM ${t().payment} WHERE group_id = ${lisbon}`),
    ).toHaveLength(1);
    // Sam, not on Tally yet, with a live invitation.
    expect(
      await dbGet(
        app,
        sql`SELECT p.name, p.account_id AS "accountId" FROM ${t().invitation} i JOIN ${t().person} p ON p.id = i.person_id
            WHERE i.group_id = ${lisbon} AND i.accepted_at IS NULL AND i.revoked_at IS NULL`,
      ),
    ).toEqual({ name: 'Sam', accountId: null });
    // Simplify debts on in one and off in another; one closed.
    const flags = await dbAll<{ id: string; simplify: number | boolean; closed: number | null }>(
      app,
      sql`SELECT id, simplify_debts AS simplify, closed_at AS closed FROM ${t().grp}`,
    );
    const flag = (gid: string) => flags.find((f) => f.id === gid);
    expect(Boolean(Number(flag(GROUPS.flat)?.simplify))).toBe(true);
    expect(Boolean(Number(flag(GROUPS.lisbon)?.simplify))).toBe(false);
    expect(flag(GROUPS.ski)?.closed).not.toBeNull();
    // Every member with an account holds each of their groups' keys.
    expect(
      await dbAll(
        app,
        sql`SELECT m.id FROM ${t().member} m JOIN ${t().person} p ON p.id = m.person_id
            WHERE p.account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${t().keyWrap} k WHERE k.group_id = m.group_id AND k.account_id = p.account_id)`,
      ),
    ).toEqual([]);
  });

  it('is the same on a second run, which changes nothing', async () => {
    const before = await counts();
    await runSeed(stores(), URL_, auth.settings.secret);
    expect(await counts()).toEqual(before);
  });

  it('signs in with its password, which also unlocks the account’s key', async () => {
    const who = PEOPLE[1];
    const values = await derivePassword(SEED_PASSWORD, URL_, who.email);
    const client = auth.client();
    const reply = await client.post('/api/auth/sign-in/email', {
      email: who.email,
      password: `raw:${values.signIn}`,
    });
    expect(reply.status).toBe(200);
    const accountId = reply.body.user.id as string;
    const wrap = await dbGet<{ wrapped: string }>(
      app,
      sql`SELECT wrapped FROM ${t().accountKeyWrap} WHERE account_id = ${accountId} AND method = 'password'`,
    );
    await expect(
      unwrapWithSecret(wrap?.wrapped ?? '', values.unwrap, 'password', [accountId, 1]),
    ).resolves.toHaveLength(32);
  });

  it('starts again with --reset', async () => {
    const before = await counts();
    await removeSeed(stores());
    expect(await dbAll(app, sql`SELECT id FROM ${t().grp}`)).toEqual([]);
    await runSeed(stores(), URL_, auth.settings.secret);
    expect(await counts()).toEqual(before);
  });

  it('runs against nothing but this machine', () => {
    const file = {
      dialect: 'sqlite',
      form: 'file',
      path: '/tmp/x.db',
      authPath: '/tmp/y.db',
    } as const;
    expect(isLocal('http://localhost:3004', file)).toBe(true);
    expect(isLocal('https://tally.example.com', file)).toBe(false);
    expect(isLocal(undefined, file)).toBe(false);
    expect(
      isLocal('http://localhost:3004', {
        dialect: 'postgres',
        url: 'postgres://u:p@db.example.com/t',
        poolMax: 10,
      } as never),
    ).toBe(false);
    expect(
      isLocal('http://localhost:3004', {
        dialect: 'postgres',
        url: 'postgres://u:p@localhost:5432/t',
        poolMax: 10,
      } as never),
    ).toBe(true);
  });
});
