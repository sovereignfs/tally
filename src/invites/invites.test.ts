import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type Person, type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { addExpense, expenseRow } from '../actions';
import { makeAuth } from '../auth/test-support';
import { balances } from '../balances';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { dbAll, dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { opsHandler } from '../groups/api';
import { toMinor } from '../money/amount';
import { personOfAccount } from '../people/persons';
import { applyMutation } from '../sync/apply';
import { acceptHandler } from './api';
import { createInvitation, validInvitation } from './store';
import { prune } from '../sync/prune';

/**
 * Invitations and claiming (DESIGN.md §6.3, §6.4) on each database: a placeholder's place, with its expenses and balance, taken by the account that
 * accepts; a used, expired, revoked or made-up link all read the same; a mailed invitation is in the outbox; an account already in the group is refused;
 * sign-up by invitation lets an account be made for a live invitation and for nothing else.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;

describe(`invitations (${leg})`, () => {
  let t: TwoAccounts;
  let ops: (request: Request) => Promise<Response>;
  let accept: (request: Request) => Promise<Response>;
  let sealed = '';
  const groupId = crypto.randomUUID();
  let samMember = '';
  let samPerson = '';
  let adaMember = '';

  const call = async (who: Person, body: Record<string, unknown>) => {
    const reply = await ops(t.request(who, '/api/ops', { method: 'POST', body }));
    return {
      status: reply.status,
      body: (await reply.json().catch(() => null)) as Record<string, unknown> | null,
    };
  };
  const take = async (who: Person, token: string) => {
    const reply = await accept(t.request(who, '/api/invite', { method: 'POST', body: { token } }));
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
    accept = accountRoute(
      acceptHandler(async () => t.database),
      t.deps,
    );
    for (const who of [t.ada, t.grace]) await call(who, { op: 'group.read', groupId });
    sealed = await sealRow({ name: 'Lisbon' }, await importGroupKey(newGroupKey()), 1, {
      group: groupId,
      table: 'grp',
      row: groupId,
    });
    await call(t.ada, {
      op: 'group.create',
      groupId,
      sealed,
      color: '#2563eb',
      defaultCurrency: 'EUR',
      keyWrap: WRAP,
    });
    const sam = await call(t.ada, { op: 'member.add', groupId, name: 'Sam' });
    samMember = String(sam.body?.memberId);
    samPerson = String(sam.body?.personId);
    adaMember =
      (
        await dbGet<{ id: string }>(
          t.database,
          sql`SELECT m.id FROM ${tables(t.database).member} m JOIN ${tables(t.database).person} p ON p.id = m.person_id WHERE m.group_id = ${groupId} AND p.account_id = ${t.ada.id}`,
        )
      )?.id ?? '';
    // Ada pays 30.00 for herself and Sam: Sam owes 15.00.
    const order = [adaMember, samMember];
    const expenseSealed = await sealRow(
      { description: 'x', note: null },
      await importGroupKey(newGroupKey()),
      1,
      { group: groupId, table: 'expense', row: 'x' },
    );
    const row = expenseRow(
      {
        sealed: expenseSealed,
        amount: toMinor(3_000),
        currency: 'EUR',
        date: '2026-11-14',
        category: 'general',
        method: 'equal',
        payers: [{ memberId: adaMember, amount: toMinor(3_000) }],
        split: order.map((memberId) => ({ memberId, units: null })),
      },
      order,
    );
    if (!row.ok) throw new Error('fixture');
    const ada = {
      accountId: t.ada.id,
      personId: (await personOfAccount(t.database, t.ada.id))?.id ?? '',
    };
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
  });
  afterAll(async () => t.close());

  it('is made by a member, for a placeholder of the group, and by nobody else', async () => {
    const made = await call(t.ada, { op: 'invite.create', groupId, personId: samPerson });
    expect(made.status).toBe(200);
    expect(String(made.body?.token)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(made.body).toMatchObject({ mailed: false, mailOn: false });
    // Only its hash is kept.
    const stored = await dbAll<{ hash: string }>(
      t.database,
      sql`SELECT token_hash AS hash FROM ${tables(t.database).invitation} WHERE person_id = ${samPerson}`,
    );
    expect(stored.every((s) => s.hash !== made.body?.token)).toBe(true);
    expect(
      (await call(t.grace, { op: 'invite.create', groupId, personId: samPerson })).status,
    ).toBe(404);
  });

  it('is claimed by the account that accepts: Sam’s place, expenses and balance become theirs, and the placeholder goes', async () => {
    const made = await call(t.ada, { op: 'invite.create', groupId, personId: samPerson });
    const token = String(made.body?.token);
    expect((await validInvitation(t.database, token, Date.now()))?.inviterName).toBe('Ada');
    const claimed = await take(t.grace, token);
    expect(claimed).toMatchObject({ status: 200, body: { groupId, refused: [] } });
    const member = await dbGet<{ personId: string; role: string }>(
      t.database,
      sql`SELECT person_id AS "personId", role FROM ${tables(t.database).member} WHERE id = ${samMember}`,
    );
    expect(member).toEqual({
      personId: (await personOfAccount(t.database, t.grace.id))?.id,
      role: 'member',
    });
    expect(
      await dbGet(
        t.database,
        sql`SELECT id FROM ${tables(t.database).person} WHERE id = ${samPerson}`,
      ),
    ).toBeUndefined();
    // The same member, so the same balance: Grace now owes 15.00.
    const payers = await dbAll<{ memberId: string; amount: number }>(
      t.database,
      sql`SELECT member_id AS "memberId", amount FROM ${tables(t.database).expensePayer} WHERE group_id = ${groupId}`,
    );
    const shares = await dbAll<{ memberId: string; amount: number }>(
      t.database,
      sql`SELECT member_id AS "memberId", amount FROM ${tables(t.database).expenseShare} WHERE group_id = ${groupId}`,
    );
    const table = balances(
      {
        expenses: [
          {
            currency: 'EUR',
            payers: payers.map((p) => ({
              memberId: p.memberId,
              amount: toMinor(Number(p.amount)),
            })),
            shares: shares.map((s) => ({
              memberId: s.memberId,
              amount: toMinor(Number(s.amount)),
            })),
          },
        ],
        payments: [],
      },
      [adaMember, samMember],
    );
    expect(table.get('EUR')?.get(samMember)).toBe(-1_500);
    expect((await call(t.grace, { op: 'group.read', groupId })).status).toBe(200);
    // Used once.
    expect((await take(t.grace, token)).status).toBe(404);
  });

  it('reads the same for a link that is made up, expired or revoked', async () => {
    const lee = await call(t.ada, { op: 'member.add', groupId, name: 'Lee' });
    const leePerson = String(lee.body?.personId);
    const made = await call(t.ada, { op: 'invite.create', groupId, personId: leePerson });
    const token = String(made.body?.token);
    expect((await call(t.ada, { op: 'invite.revoke', groupId, personId: leePerson })).status).toBe(
      200,
    );
    expect(await validInvitation(t.database, token, Date.now())).toBeUndefined();
    expect((await take(t.grace, token)).status).toBe(404);
    const fresh = String(
      (await call(t.ada, { op: 'invite.create', groupId, personId: leePerson })).body?.token,
    );
    await dbRun(
      t.database,
      sql`UPDATE ${tables(t.database).invitation} SET expires_at = 1 WHERE person_id = ${leePerson} AND revoked_at IS NULL`,
    );
    expect((await take(t.grace, fresh)).status).toBe(404);
    expect((await take(t.grace, 'A'.repeat(43))).status).toBe(404);
    expect((await take(t.grace, 'short')).status).toBe(404);
  });

  it('refuses an account already in the group, and keeps the invitation', async () => {
    const kim = await call(t.ada, { op: 'member.add', groupId, name: 'Kim' });
    const token = String(
      (await call(t.ada, { op: 'invite.create', groupId, personId: String(kim.body?.personId) }))
        .body?.token,
    );
    expect(await take(t.ada, token)).toMatchObject({
      status: 409,
      body: { code: 'already_member' },
    });
    expect(await validInvitation(t.database, token, Date.now())).toBeDefined();
  });

  it('puts a mailed invitation in the outbox, with no key and no group name, and mails a person at most once an hour', async () => {
    const mo = await call(t.ada, {
      op: 'member.add',
      groupId,
      email: 'mo@example.com',
      name: 'Mo',
    });
    const ada = {
      accountId: t.ada.id,
      personId: (await personOfAccount(t.database, t.ada.id))?.id ?? '',
    };
    const made = await createInvitation(
      t.database,
      ada,
      { groupId, personId: String(mo.body?.personId) },
      { now: Date.now(), mail: { origin: 'https://tally.test', inviterName: 'Ada' } },
    );
    expect(made.mailed).toBe(true);
    const mail = await dbGet<{ to: string; data: string }>(
      t.database,
      sql`SELECT to_address AS "to", data FROM ${tables(t.database).mailOutbox} ORDER BY created_at DESC LIMIT 1`,
    );
    expect(mail?.to).toBe('mo@example.com');
    expect(JSON.parse(mail?.data ?? '{}')).toEqual({
      inviterName: 'Ada',
      link: `https://tally.test/invite/${made.token}`,
    });
    expect(mail?.data).not.toContain('#');

    // A new link within the hour is made, and not mailed: an address cannot be flooded by making links.
    const mails = async () =>
      Number(
        (
          await dbGet<{ n: number }>(
            t.database,
            sql`SELECT COUNT(*) AS n FROM ${tables(t.database).mailOutbox} WHERE to_address = 'mo@example.com'`,
          )
        )?.n,
      );
    const before = await mails();
    for (let i = 0; i < 3; i++) {
      const again = await createInvitation(
        t.database,
        ada,
        { groupId, personId: String(mo.body?.personId) },
        { now: Date.now(), mail: { origin: 'https://tally.test', inviterName: 'Ada' } },
      );
      expect(again).toMatchObject({ mailed: false, mailHeld: true });
    }
    expect(await mails()).toBe(before);
    // An hour on, one goes again.
    const later = await createInvitation(
      t.database,
      ada,
      { groupId, personId: String(mo.body?.personId) },
      {
        now: Date.now() + 61 * 60 * 1000,
        mail: { origin: 'https://tally.test', inviterName: 'Ada' },
      },
    );
    expect(later.mailed).toBe(true);
  });
});

describe(`an invitation that carries the key (${leg})`, () => {
  let t: TwoAccounts;
  let ops: (request: Request) => Promise<Response>;
  let accept: (request: Request) => Promise<Response>;
  const groupId = crypto.randomUUID();
  const call = async (who: Person, body: Record<string, unknown>) => {
    const reply = await ops(t.request(who, '/api/ops', { method: 'POST', body }));
    return (await reply.json().catch(() => null)) as Record<string, unknown> | null;
  };
  const wrapOf = async (personId: string) =>
    (
      await dbGet<{ keyWrap: string | null }>(
        t.database,
        sql`SELECT key_wrap AS "keyWrap" FROM ${tables(t.database).invitation} WHERE person_id = ${personId} ORDER BY created_at DESC LIMIT 1`,
      )
    )?.keyWrap;
  const KEY_WRAP = `w1.${'Q'.repeat(60)}`;

  beforeAll(async () => {
    t = await twoAccounts();
    ops = accountRoute(
      opsHandler(async () => t.database),
      t.deps,
    );
    accept = accountRoute(
      acceptHandler(async () => t.database),
      t.deps,
    );
    for (const who of [t.ada, t.grace]) await call(who, { op: 'group.read', groupId });
    const sealed = await sealRow({ name: 'Porto' }, await importGroupKey(newGroupKey()), 1, {
      group: groupId,
      table: 'grp',
      row: groupId,
    });
    await call(t.ada, {
      op: 'group.create',
      groupId,
      sealed,
      color: '#2563eb',
      defaultCurrency: 'EUR',
      keyWrap: WRAP,
    });
  });
  afterAll(async () => t.close());

  it('keeps the claimer’s own wrap with the claim, and no wrap once used, revoked or ended', async () => {
    const sam = String((await call(t.ada, { op: 'member.add', groupId, name: 'Sam' }))?.personId);
    const token = String(
      (await call(t.ada, { op: 'invite.create', groupId, personId: sam, keyWrap: KEY_WRAP }))
        ?.token,
    );
    expect(await wrapOf(sam)).toBe(KEY_WRAP);
    expect((await validInvitation(t.database, token, Date.now()))?.keyWrap).toBe(KEY_WRAP);
    const selfWrap = { epoch: 1, wrapped: `h1.${'S'.repeat(60)}` };
    const reply = await accept(
      t.request(t.grace, '/api/invite', { method: 'POST', body: { token, selfWrap } }),
    );
    expect(reply.status).toBe(200);
    expect(await wrapOf(sam)).toBeNull();
    const kept = await dbGet<{ wrapped: string }>(
      t.database,
      sql`SELECT wrapped FROM ${tables(t.database).keyWrap} WHERE group_id = ${groupId} AND account_id = ${t.grace.id}`,
    );
    expect(kept?.wrapped).toBe(selfWrap.wrapped);

    const lee = String((await call(t.ada, { op: 'member.add', groupId, name: 'Lee' }))?.personId);
    await call(t.ada, { op: 'invite.create', groupId, personId: lee, keyWrap: KEY_WRAP });
    await call(t.ada, { op: 'invite.revoke', groupId, personId: lee });
    expect(await wrapOf(lee)).toBeNull();
    await call(t.ada, { op: 'invite.create', groupId, personId: lee, keyWrap: KEY_WRAP });
    await dbRun(
      t.database,
      sql`UPDATE ${tables(t.database).invitation} SET expires_at = 1 WHERE person_id = ${lee} AND revoked_at IS NULL`,
    );
    await prune(t.database, Date.now());
    expect(await wrapOf(lee)).toBeNull();
  });

  it('keeps no wrap a claimer sends with an invitation that carried none', async () => {
    const kim = String((await call(t.ada, { op: 'member.add', groupId, name: 'Kim' }))?.personId);
    const token = String(
      (await call(t.ada, { op: 'invite.create', groupId, personId: kim }))?.token,
    );
    // Grace is in the group already through Sam: the claim is refused, and nothing is kept.
    await accept(
      t.request(t.grace, '/api/invite', {
        method: 'POST',
        body: { token, selfWrap: { epoch: 1, wrapped: `h1.${'T'.repeat(60)}` } },
      }),
    );
    const wraps = await dbAll<{ wrapped: string }>(
      t.database,
      sql`SELECT wrapped FROM ${tables(t.database).keyWrap} WHERE group_id = ${groupId} AND account_id = ${t.grace.id}`,
    );
    expect(wraps.map((w) => w.wrapped)).not.toContain(`h1.${'T'.repeat(60)}`);
  });
});

describe(`sign-up by invitation (${leg})`, () => {
  it('makes an account for a live invitation, and for nobody else', async () => {
    const live = 'L'.repeat(43);
    const auth = await makeAuth(
      { signUp: 'invite' },
      undefined,
      undefined,
      undefined,
      async (token) => token === live,
    );
    try {
      let ip = 10;
      const signUp = (email: string, headers: Record<string, string> = {}) =>
        auth
          .client()
          .from(`203.0.113.${ip++}`)
          .post(
            '/api/auth/sign-up/email',
            { name: 'X', email, password: 'a password long enough to be one' },
            headers,
          );
      expect((await signUp('first@example.com')).status).toBe(200);
      expect((await signUp('nobody@example.com')).status).toBe(403);
      expect((await signUp('wrong@example.com', { 'x-tally-invite': 'W'.repeat(43) })).status).toBe(
        403,
      );
      expect((await signUp('sam@example.com', { 'x-tally-invite': live })).status).toBe(200);
    } finally {
      await auth.close();
    }
  });
});
