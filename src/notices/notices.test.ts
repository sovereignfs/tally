import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type Person, type TwoAccounts, twoAccounts } from '../access/two-accounts';
import {
  addComment,
  addExpense,
  addPayment,
  deleteExpense,
  editExpense,
  expenseRow,
} from '../actions';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { dbAll, dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { opsHandler } from '../groups/api';
import { acceptInvitation, createInvitation } from '../invites/store';
import { toMinor } from '../money/amount';
import { personOfAccount } from '../people/persons';
import { type Actor, applyMutation } from '../sync/apply';
import { noticesHandler } from './api';
import type { NoticeRow } from './kinds';

/**
 * Notices (DESIGN.md §12.2), on each database: for each kind and each choice, who is told, and never the person who acted; a new member hears
 * everything until they choose otherwise; reading on one device reads on another; a notice of a group left is not shown; nobody reads another's.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;
const m = (value: number) => toMinor(value);

describe(`notices (${leg})`, () => {
  let t: TwoAccounts;
  let ops: (request: Request) => Promise<Response>;
  let notices: { GET: (r: Request) => Promise<Response>; POST: (r: Request) => Promise<Response> };
  let sealed = '';
  let ada: Actor;
  let grace: Actor;
  let n = 0;
  const mid = () => `mutation-${++n}-${crypto.randomUUID().slice(0, 8)}`;
  const call = (who: Person, body: Record<string, unknown>) =>
    ops(t.request(who, '/api/ops', { method: 'POST', body }));
  const db = () => tables(t.database);

  /** A group of Ada's (owner) with Grace as a member and Sam, a placeholder. */
  async function group() {
    const groupId = crypto.randomUUID();
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
      sql`INSERT INTO ${db().person} (id, name, created_at, updated_at) VALUES (${ids.samPerson}, 'Sam', 1, 1)`,
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

  const row = (members: string[], payer: string, amount: number) => {
    const made = expenseRow(
      {
        sealed,
        amount: m(amount),
        currency: 'EUR',
        date: '2026-11-02',
        category: 'general',
        method: 'equal',
        payers: [{ memberId: payer, amount: m(amount) }],
        split: members.map((memberId) => ({ memberId, units: null })),
      },
      [...new Set([...members, payer])],
    );
    if (!made.ok) throw new Error(made.refusal.code);
    return made.value;
  };
  async function expense(who: Actor, groupId: string, members: string[], payer: string) {
    const expenseId = crypto.randomUUID();
    const applied = await applyMutation(
      t.database,
      who,
      addExpense({ mutationId: mid(), groupId, expenseId, row: row(members, payer, 900) }),
    );
    expect(applied.status).toBe('applied');
    return expenseId;
  }
  /** The notices raised for an account in a group, as their kinds. */
  const told = async (who: Person, groupId: string) =>
    (
      await dbAll<{ kind: string }>(
        t.database,
        sql`SELECT kind FROM ${db().notice} WHERE account_id = ${who.id} AND group_id = ${groupId} ORDER BY created_at, id`,
      )
    ).map((r) => r.kind);
  const list = async (who: Person) =>
    (await (await notices.GET(t.request(who, '/api/notices'))).json()) as {
      notices: NoticeRow[];
      unread: number;
    };
  const post = (who: Person, body: Record<string, unknown>) =>
    notices.POST(t.request(who, '/api/notices', { method: 'POST', body }));

  beforeAll(async () => {
    t = await twoAccounts();
    ops = accountRoute(
      opsHandler(async () => t.database),
      t.deps,
    );
    const handler = noticesHandler(async () => t.database);
    notices = { GET: accountRoute(handler.GET, t.deps), POST: accountRoute(handler.POST, t.deps) };
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

  it('Everything, the default: a member is told of every expense, payment, comment and closing, and the one who acted never is', async () => {
    const g = await group();
    const expenseId = await expense(ada, g.groupId, [g.ada, g.sam], g.ada);
    await applyMutation(
      t.database,
      ada,
      addPayment({
        mutationId: mid(),
        groupId: g.groupId,
        paymentId: crypto.randomUUID(),
        row: {
          sealed: null,
          fromMemberId: g.sam,
          toMemberId: g.ada,
          amount: m(100),
          currency: 'EUR',
          date: '2026-11-03',
        },
      }),
    );
    await applyMutation(
      t.database,
      ada,
      addComment({
        mutationId: mid(),
        groupId: g.groupId,
        commentId: crypto.randomUUID(),
        subject: 'expense',
        subjectId: expenseId,
        sealed,
      }),
    );
    await applyMutation(
      t.database,
      ada,
      deleteExpense({
        mutationId: mid(),
        groupId: g.groupId,
        current: { id: expenseId, version: 1 },
      }),
    );
    expect(await told(t.grace, g.groupId)).toEqual([
      'expense_added',
      'payment_recorded',
      'comment',
      'expense_changed',
    ]);
    expect(await told(t.ada, g.groupId)).toEqual([]);
  });

  it('Only what involves me: an expense or payment they are on, a comment on one or after theirs, and closing', async () => {
    const g = await group();
    expect(
      (await call(t.grace, { op: 'member.notify', groupId: g.groupId, notify: 'involved' })).status,
    ).toBe(200);
    const notHers = await expense(ada, g.groupId, [g.ada, g.sam], g.ada);
    await expense(ada, g.groupId, [g.ada, g.grace], g.ada);
    await expense(ada, g.groupId, [g.ada], g.grace);
    // A comment on one she is not on: not told; after she commented on it, told.
    const comment = (who: Actor) =>
      applyMutation(
        t.database,
        who,
        addComment({
          mutationId: mid(),
          groupId: g.groupId,
          commentId: crypto.randomUUID(),
          subject: 'expense',
          subjectId: notHers,
          sealed,
        }),
      );
    await comment(ada);
    await comment(grace);
    await comment(ada);
    expect(await told(t.grace, g.groupId)).toEqual(['expense_added', 'expense_added', 'comment']);
    // Settled, the group closes: closing involves everyone.
    await applyMutation(
      t.database,
      ada,
      deleteExpense({
        mutationId: mid(),
        groupId: g.groupId,
        current: { id: notHers, version: 1 },
      }),
    );
    for (const id of (
      await dbAll<{ id: string }>(
        t.database,
        sql`SELECT id FROM ${db().expense} WHERE group_id = ${g.groupId} AND deleted_at IS NULL`,
      )
    ).map((r) => r.id))
      await applyMutation(
        t.database,
        ada,
        deleteExpense({ mutationId: mid(), groupId: g.groupId, current: { id, version: 1 } }),
      );
    expect((await call(t.ada, { op: 'group.close', groupId: g.groupId })).status).toBe(200);
    expect((await told(t.grace, g.groupId)).slice(-1)).toEqual(['group_closed']);
  });

  it('Nothing: none of the group’s kinds, but the personal ones still; and a replaced edit tells its author', async () => {
    const g = await group();
    expect(
      (await call(t.grace, { op: 'member.notify', groupId: g.groupId, notify: 'none' })).status,
    ).toBe(200);
    const expenseId = await expense(ada, g.groupId, [g.ada, g.grace], g.ada);
    // Grace edits from version 1, and Ada, from version 1 too, after her: Grace's version is replaced, and she is told whatever her choice.
    for (const who of [grace, ada])
      expect(
        (
          await applyMutation(
            t.database,
            who,
            editExpense({
              mutationId: mid(),
              groupId: g.groupId,
              current: { id: expenseId, version: 1 },
              row: row([g.ada, g.grace], g.ada, who === grace ? 600 : 300),
            }),
          )
        ).status,
      ).toBe('applied');
    expect(await told(t.grace, g.groupId)).toEqual(['edit_replaced']);
    expect(await told(t.ada, g.groupId)).toEqual(['expense_changed']);
  });

  it('tells the person added, and whoever invited when an invitation is taken', async () => {
    const g = await group();
    await call(t.grace, { op: 'member.leave', groupId: g.groupId });
    const added = await call(t.ada, {
      op: 'member.add',
      groupId: g.groupId,
      personId: grace.personId,
    });
    expect(added.status).toBe(200);
    expect(await told(t.grace, g.groupId)).toEqual(['added_to_group']);

    // Grace leaves again, and takes Sam's place by the link Ada made.
    await call(t.grace, { op: 'member.leave', groupId: g.groupId });
    const made = await createInvitation(
      t.database,
      ada,
      { groupId: g.groupId, personId: g.samPerson },
      { now: Date.now() },
    );
    await dbRun(t.database, sql`DELETE FROM ${db().member} WHERE id = ${g.grace}`);
    await acceptInvitation(t.database, grace, made.token, Date.now());
    expect(await told(t.ada, g.groupId)).toEqual(['invite_accepted']);
  });

  it('a new member hears everything until they choose otherwise', async () => {
    const g = await group();
    const fresh = await call(t.ada, { op: 'member.add', groupId: g.groupId, name: 'Kim' });
    expect(fresh.status).toBe(200);
    const notify = await dbGet<{ notify: string }>(
      t.database,
      sql`SELECT m.notify FROM ${db().member} m JOIN ${db().person} p ON p.id = m.person_id WHERE m.group_id = ${g.groupId} AND p.name = 'Kim'`,
    );
    expect(notify).toEqual({ notify: 'all' });
  });

  it('reads on one device and on another; marks all read; dismisses; hides a group left; and reads only the account’s own', async () => {
    await post(t.grace, { action: 'clear_all' });
    const g = await group();
    for (let i = 0; i < 3; i++) await expense(ada, g.groupId, [g.ada, g.grace], g.ada);
    const first = await list(t.grace);
    expect(first.unread).toBe(3);
    expect(first.notices.map((x) => x.kind)).toEqual([
      'expense_added',
      'expense_added',
      'expense_added',
    ]);
    expect(first.notices[0]?.line).toMatchObject({ kind: 'expense_added', groupId: g.groupId });
    const [one, two] = first.notices;

    // Ada cannot read or dismiss Grace's.
    expect((await post(t.ada, { action: 'read', ids: [one?.id] })).status).toBe(200);
    expect((await post(t.ada, { action: 'dismiss', ids: [two?.id] })).status).toBe(200);
    expect((await list(t.grace)).unread).toBe(3);

    // Read on one device; another reads the same.
    await post(t.grace, { action: 'read', ids: [one?.id] });
    const second = await list(t.grace);
    expect(second.unread).toBe(2);
    expect(second.notices.find((x) => x.id === one?.id)?.read).toBe(true);
    await post(t.grace, { action: 'dismiss', ids: [two?.id] });
    expect((await list(t.grace)).notices.map((x) => x.id)).not.toContain(two?.id);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await post(t.grace, { action: 'read_all' });
    expect((await list(t.grace)).unread).toBe(0);
    await expense(ada, g.groupId, [g.ada, g.grace], g.ada);
    expect((await list(t.grace)).unread).toBe(1);

    // Settled up and gone: none of the group's notices is shown or counted.
    await dbRun(t.database, sql`UPDATE ${db().member} SET left_at = 1 WHERE id = ${g.grace}`);
    const after = await list(t.grace);
    expect(after.unread).toBe(0);
    expect(after.notices.filter((x) => x.groupId === g.groupId)).toEqual([]);

    // A request it does not understand is refused.
    expect((await post(t.grace, { action: 'shred' })).status).toBe(400);
    expect((await post(t.grace, { action: 'read', ids: ['x y'] })).status).toBe(400);
  });
});
