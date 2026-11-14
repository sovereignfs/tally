import { getTableName, is, sql } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { asSignInValue } from '../auth/test-support';
import * as sqliteApp from '../db/schema/sqlite/app';
import * as postgresSchema from '../db/schema/postgres';
import * as sqliteSchema from '../db/schema/sqlite';
import { dbAll, dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { createAccountKey, createRequest } from '../keys/store';
import { RateLimiter } from '../limits/rate';
import { setPrimaryCurrency } from '../account/settings';
import { ensurePerson, personById } from '../people/persons';
import { deleteAccount, deletionPreview, type DeleteDeps } from './delete-account';
import { ACCOUNT_TABLES, GROUP_TABLES, SHARED_TABLES, deletePerson } from './people';

/**
 * `People.deletePerson` (DESIGN.md §18): a row of every table for Ada and for Grace, then Ada deleted. Nothing personal of Ada is left but her name on
 * the shared record; Grace's groups, keys and sign-in are intact; and a table that is in none of the routine's lists fails here.
 */
const { leg } = testTarget();
const PASSWORD = 'a password long enough to be one';
const pk = (c: string) => c.repeat(43);
const wrap = (c: string) => `h1.${c.repeat(60)}`;

describe('the tables deletion knows', () => {
  it('are every table of the app store, each decided once', () => {
    const all = Object.values(sqliteApp)
      .filter((value) => is(value, SQLiteTable))
      .map((table) => getTableName(table as SQLiteTable))
      .sort();
    const decided = [...GROUP_TABLES, ...ACCOUNT_TABLES, ...SHARED_TABLES].sort();
    expect(decided).toEqual(all);
    expect(new Set(decided).size).toBe(decided.length);
  });
});

describe(`deleting a person (${leg})`, () => {
  let t: TwoAccounts;
  let deps: DeleteDeps;
  const ids = {
    alone: crypto.randomUUID(),
    shared: crypto.randomUUID(),
    hers: crypto.randomUUID(),
  };
  const placeholders = { inNoGroup: crypto.randomUUID(), inShared: crypto.randomUUID() };
  let adaPerson = '';
  let gracePerson = '';

  async function group(id: string, by: string) {
    await dbRun(
      t.database,
      sql`INSERT INTO ${tables(t.database).grp} (id, sealed, color, default_currency, simplify_debts, closed_at, key_epoch, seq, created_by, created_at, updated_at)
          VALUES (${id}, 's1.1.x', '#2563eb', 'EUR', ${false}, NULL, 1, 1, ${by}, 1, 1)`,
    );
  }
  async function member(groupId: string, personId: string, role: string | null, joinedAt: number) {
    await dbRun(
      t.database,
      sql`INSERT INTO ${tables(t.database).member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
          VALUES (${crypto.randomUUID()}, ${groupId}, ${personId}, ${role}, 'all', NULL, ${joinedAt}, NULL, 1)`,
    );
  }
  async function keyWrap(groupId: string, accountId: string) {
    await dbRun(
      t.database,
      sql`INSERT INTO ${tables(t.database).keyWrap} (group_id, epoch, account_id, wrapped, wrapped_by, created_at)
          VALUES (${groupId}, 1, ${accountId}, ${wrap('w')}, ${accountId}, 1)`,
    );
  }
  async function recorded(groupId: string) {
    const db = tables(t.database);
    const expenseId = crypto.randomUUID();
    const paymentId = crypto.randomUUID();
    await dbRun(
      t.database,
      sql`INSERT INTO ${db.expense} (id, group_id, amount, currency, date, category, sealed, method, version, created_by, updated_by, deleted_at, seq, created_at, updated_at)
          VALUES (${expenseId}, ${groupId}, 100, 'EUR', '2026-11-01', 'general', 's1.1.x', 'equal', 1, ${adaPerson}, ${adaPerson}, NULL, 1, 1, 1)`,
    );
    await dbRun(
      t.database,
      sql`INSERT INTO ${db.expensePayer} (expense_id, member_id, group_id, amount) VALUES (${expenseId}, 'm-ada', ${groupId}, 100)`,
    );
    await dbRun(
      t.database,
      sql`INSERT INTO ${db.expenseShare} (expense_id, member_id, group_id, amount, units) VALUES (${expenseId}, 'm-ada', ${groupId}, 100, NULL)`,
    );
    await dbRun(
      t.database,
      sql`INSERT INTO ${db.payment} (id, group_id, from_member_id, to_member_id, amount, currency, date, sealed, version, created_by, updated_by, deleted_at, seq, created_at, updated_at)
          VALUES (${paymentId}, ${groupId}, 'm-ada', 'm-grace', 100, 'EUR', '2026-11-01', NULL, 1, ${adaPerson}, ${adaPerson}, NULL, 2, 1, 1)`,
    );
    await dbRun(
      t.database,
      sql`INSERT INTO ${db.revision} (id, group_id, subject, subject_id, version, kind, snapshot, actor_person_id, created_at)
          VALUES (${crypto.randomUUID()}, ${groupId}, 'expense', ${expenseId}, 1, 'created', '{}', ${adaPerson}, 1)`,
    );
    await dbRun(
      t.database,
      sql`INSERT INTO ${db.activity} (id, group_id, actor_person_id, kind, subject_id, details, created_at)
          VALUES (${crypto.randomUUID()}, ${groupId}, ${adaPerson}, 'expense_added', ${expenseId}, '{}', 1)`,
    );
    await dbRun(
      t.database,
      sql`INSERT INTO ${db.comment} (id, group_id, subject, subject_id, author_person_id, sealed, deleted_at, seq, created_at)
          VALUES (${crypto.randomUUID()}, ${groupId}, 'expense', ${expenseId}, ${adaPerson}, 's1.1.x', NULL, 3, 1)`,
    );
    for (const who of [t.ada.id, t.grace.id])
      await dbRun(
        t.database,
        sql`INSERT INTO ${db.appliedMutation} (account_id, id, group_id, seq, created_at) VALUES (${who}, ${crypto.randomUUID()}, ${groupId}, 1, 1)`,
      );
  }
  async function placeholder(id: string, addedBy: string) {
    await dbRun(
      t.database,
      sql`INSERT INTO ${tables(t.database).person} (id, name, email, added_by, created_at, updated_at) VALUES (${id}, 'Sam', 'sam@example.com', ${addedBy}, 1, 1)`,
    );
  }
  const count = async (table: unknown, where: ReturnType<typeof sql>, database = t.database) =>
    Number(
      (await dbGet<{ n: number }>(database, sql`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))
        ?.n ?? 0,
    );

  beforeAll(async () => {
    t = await twoAccounts();
    deps = {
      database: t.database,
      authDatabase: t.auth.database,
      limiter: new RateLimiter(t.database),
      now: () => 5_000,
      verify: async (request, password) => {
        try {
          return (
            (await t.auth.auth.api.verifyPassword({ body: { password }, headers: request.headers }))
              .status === true
          );
        } catch {
          return false;
        }
      },
      hasPassword: async () => true,
      fresh: async () => false,
    };
    adaPerson = (await ensurePerson(t.database, { id: t.ada.id, name: 'Ada', email: t.ada.email }))
      .id;
    gracePerson = (
      await ensurePerson(t.database, { id: t.grace.id, name: 'Grace', email: t.grace.email })
    ).id;
    // One of everything, for each of them.
    for (const [who, c] of [
      [t.ada.id, 'a'],
      [t.grace.id, 'g'],
    ] as const) {
      await createAccountKey(t.database, who, pk(c), [
        { method: 'password', params: 'argon2id:1', wrapped: wrap(c) },
      ]);
      await createRequest(t.database, who, pk(c), 'Phone');
      await setPrimaryCurrency(t.database, who, 'JPY');
      await dbRun(
        t.database,
        sql`INSERT INTO ${tables(t.database).rateBucket} ("key", window_start, "count") VALUES (${`sign-in:${who}`}, 1, 1)`,
      );
    }
    // Ada's group alone; a group Ada owns and Grace is in; Grace's group, which Ada is in.
    await group(ids.alone, adaPerson);
    await member(ids.alone, adaPerson, 'owner', 1);
    await keyWrap(ids.alone, t.ada.id);
    await group(ids.shared, adaPerson);
    await member(ids.shared, adaPerson, 'owner', 1);
    await member(ids.shared, gracePerson, 'member', 2);
    await keyWrap(ids.shared, t.ada.id);
    await keyWrap(ids.shared, t.grace.id);
    await group(ids.hers, gracePerson);
    await member(ids.hers, gracePerson, 'owner', 1);
    await member(ids.hers, adaPerson, 'member', 2);
    await keyWrap(ids.hers, t.ada.id);
    await keyWrap(ids.hers, t.grace.id);
    // An expense, a payment, their revisions and the mutation that made them, in Ada's group alone and in the shared one.
    for (const groupId of [ids.alone, ids.shared]) await recorded(groupId);
    // Placeholders Ada added: one in no group, one in the shared group.
    await placeholder(placeholders.inNoGroup, adaPerson);
    await placeholder(placeholders.inShared, adaPerson);
    await member(ids.shared, placeholders.inShared, null, 3);
  });
  afterAll(async () => t.close());

  it('says what it would do before it is asked to: which groups go and which carry on', async () => {
    const preview = await (await deletionPreview(t.ada.id, deps)).json();
    expect(preview).toEqual({
      password: true,
      groupsDeleted: [ids.alone],
      groupsLeft: expect.arrayContaining([ids.shared, ids.hers]),
    });
  });

  it('asks for the password, and is not done with a wrong one', async () => {
    const route = accountRoute(
      async ({ request, accountId }) => deleteAccount(request, accountId, deps),
      t.deps,
    );
    const wrong = await route(
      t.request(t.ada, '/api/account/delete', {
        method: 'POST',
        body: { password: asSignInValue('not it') },
      }),
    );
    expect(wrong.status).toBe(403);
    expect(await personById(t.database, adaPerson)).toMatchObject({ accountId: t.ada.id });
    const right = await route(
      t.request(t.ada, '/api/account/delete', {
        method: 'POST',
        body: { password: asSignInValue(PASSWORD) },
      }),
    );
    expect(right.status).toBe(204);
  });

  it('leaves nothing personal of her: her name alone, on the record the others share', async () => {
    const ada = await personById(t.database, adaPerson);
    expect(ada).toMatchObject({
      name: 'Ada',
      accountId: null,
      email: null,
      coreSub: null,
      deletedAt: 5_000,
    });
    const db = tables(t.database);
    for (const [table, column] of [
      [db.accountKey, 'account_id'],
      [db.accountKeyWrap, 'account_id'],
      [db.keyRequest, 'account_id'],
      [db.keyWrap, 'account_id'],
      [db.accountSettings, 'account_id'],
      [db.appliedMutation, 'account_id'],
    ] as const) {
      expect(await count(table, sql`${sql.raw(column)} = ${t.ada.id}`)).toBe(0);
    }
    expect(await count(db.rateBucket, sql`"key" LIKE ${`%:${t.ada.id}`}`)).toBe(0);
    expect(await personById(t.database, placeholders.inNoGroup)).toBeUndefined();
    expect(await personById(t.database, placeholders.inShared)).toBeDefined();
    const auth = t.auth.database.dialect === 'postgres' ? postgresSchema : sqliteSchema;
    for (const table of [auth.session, auth.account, auth.passkey, auth.twoFactor]) {
      expect(await count(table, sql`user_id = ${t.ada.id}`, t.auth.database)).toBe(0);
    }
    expect(await count(auth.user, sql`id = ${t.ada.id}`, t.auth.database)).toBe(0);
  });

  it('deletes the group no other account was in, with every row of it', async () => {
    const db = tables(t.database);
    expect(await count(db.grp, sql`id = ${ids.alone}`)).toBe(0);
    for (const table of [
      db.member,
      db.keyWrap,
      db.expense,
      db.expensePayer,
      db.expenseShare,
      db.payment,
      db.revision,
      db.comment,
      db.activity,
      db.appliedMutation,
    ])
      expect(await count(table, sql`group_id = ${ids.alone}`)).toBe(0);
    // The shared group's record stays whole for Grace: what Ada paid still adds up.
    // Her comment stays too, by her name (DESIGN.md §24).
    for (const table of [
      db.expense,
      db.expensePayer,
      db.expenseShare,
      db.payment,
      db.revision,
      db.comment,
      db.activity,
    ])
      expect(await count(table, sql`group_id = ${ids.shared}`)).toBe(1);
    expect(await count(db.appliedMutation, sql`account_id = ${t.grace.id}`)).toBe(1);
  });

  it('passes a group she alone owned to its longest-standing member with an account, and keeps her place in each, as left Tally', async () => {
    const roles = await dbAll<{ personId: string; role: string | null; groupId: string }>(
      t.database,
      sql`SELECT person_id AS "personId", role, group_id AS "groupId" FROM ${tables(t.database).member}
          WHERE group_id IN (${ids.shared}, ${ids.hers}) ORDER BY group_id, joined_at`,
    );
    const roleOf = (groupId: string, personId: string) =>
      roles.find((r) => r.groupId === groupId && r.personId === personId)?.role;
    expect(roleOf(ids.shared, gracePerson)).toBe('owner');
    expect(roleOf(ids.shared, adaPerson)).toBe('member');
    expect(roleOf(ids.shared, placeholders.inShared)).toBeNull();
    expect(roleOf(ids.hers, gracePerson)).toBe('owner');
    expect(roleOf(ids.hers, adaPerson)).toBe('member');
  });

  it('leaves Grace whole: her groups, her keys and her sign-in', async () => {
    const db = tables(t.database);
    expect(await count(db.grp, sql`id IN (${ids.shared}, ${ids.hers})`)).toBe(2);
    expect(await count(db.keyWrap, sql`account_id = ${t.grace.id}`)).toBe(2);
    expect(await count(db.accountKey, sql`account_id = ${t.grace.id}`)).toBe(1);
    expect(await count(db.accountKeyWrap, sql`account_id = ${t.grace.id}`)).toBe(1);
    expect(await count(db.keyRequest, sql`account_id = ${t.grace.id}`)).toBe(1);
    expect(await count(db.accountSettings, sql`account_id = ${t.grace.id}`)).toBe(1);
    expect(await count(db.rateBucket, sql`"key" = ${`sign-in:${t.grace.id}`}`)).toBe(1);
    expect(await personById(t.database, gracePerson)).toMatchObject({
      accountId: t.grace.id,
      email: t.grace.email,
    });
    expect((await t.as(t.grace).get('/api/auth/get-session')).body.user.id).toBe(t.grace.id);
  });

  it('is safe to run again', async () => {
    await expect(deletePerson(deps, t.ada.id)).resolves.toEqual({
      groupsDeleted: 0,
      groupsLeft: 0,
    });
    expect(await personById(t.database, adaPerson)).toMatchObject({ name: 'Ada', accountId: null });
  });
});
