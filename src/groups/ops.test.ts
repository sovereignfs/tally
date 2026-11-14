import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type Person, type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { dbAll, dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { personOfAccount } from '../people/persons';
import { opsHandler } from './api';
import { MAX_GROUPS } from './ops';

/**
 * Groups, their members and access, over `POST /api/ops` with two real accounts (DESIGN.md §5.2, §7): what an owner and a member may do, and that
 * everything of a group Grace is not in reads as not there to her, whatever she names, with nothing changed.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;

describe(`groups (${leg})`, () => {
  let t: TwoAccounts;
  let ops: (request: Request) => Promise<Response>;
  const call = (who: Person, body: Record<string, unknown>) =>
    ops(t.request(who, '/api/ops', { method: 'POST', body }));

  /** A name sealed as the browser seals it: under the group's key, bound to its row, epoch 1. */
  async function sealedName(groupId: string, name: string, epoch = 1) {
    return sealRow({ name }, await importGroupKey(newGroupKey()), epoch, {
      group: groupId,
      table: 'grp',
      row: groupId,
    });
  }
  async function create(who: Person, extra: Record<string, unknown> = {}) {
    const groupId = crypto.randomUUID();
    const reply = await call(who, {
      op: 'group.create',
      groupId,
      sealed: await sealedName(groupId, 'Lisbon'),
      color: '#2563eb',
      defaultCurrency: 'EUR',
      keyWrap: WRAP,
      ...extra,
    });
    return { groupId, reply };
  }
  const seqOf = async (groupId: string) =>
    (
      await dbGet<{ seq: number }>(
        t.database,
        sql`SELECT seq FROM ${tables(t.database).grp} WHERE id = ${groupId}`,
      )
    )?.seq;
  async function addMember(
    groupId: string,
    who: Person,
    role: 'owner' | 'member' | null = 'member',
  ) {
    const person = await personOfAccount(t.database, who.id);
    const id = crypto.randomUUID();
    await dbRun(
      t.database,
      sql`INSERT INTO ${tables(t.database).member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
          VALUES (${id}, ${groupId}, ${person?.id ?? ''}, ${role}, 'all', NULL, ${Date.now()}, NULL, 1)`,
    );
    return id;
  }

  beforeAll(async () => {
    t = await twoAccounts();
    ops = accountRoute(
      opsHandler(async () => t.database),
      t.deps,
    );
    // Each account's person, made as a signed-in request makes it.
    for (const who of [t.ada, t.grace])
      await call(who, { op: 'group.read', groupId: crypto.randomUUID() });
  });
  afterAll(async () => t.close());

  it('is made by a person, who is its first owner, with its first key wrapped to them', async () => {
    const { groupId, reply } = await create(t.ada);
    expect(reply.status).toBe(201);
    const state = await reply.json();
    expect(state.group).toMatchObject({
      id: groupId,
      color: '#2563eb',
      defaultCurrency: 'EUR',
      simplifyDebts: false,
      closedAt: null,
      keyEpoch: 1,
      seq: 1,
    });
    expect(state.group.sealed).toMatch(/^s1\.1\./);
    expect(state.me).toMatchObject({ role: 'owner', notify: 'all' });
    expect(state.members).toEqual([
      expect.objectContaining({
        name: 'Ada',
        role: 'owner',
        email: 'ada@example.com',
        placeholder: false,
      }),
    ]);
    const wraps = await dbAll<{ accountId: string; epoch: number }>(
      t.database,
      sql`SELECT account_id AS "accountId", epoch FROM ${tables(t.database).keyWrap} WHERE group_id = ${groupId}`,
    );
    expect(wraps).toEqual([{ accountId: t.ada.id, epoch: 1 }]);
  });

  it('is not there for someone who is not in it: every operation is not found, and nothing changes', async () => {
    const { groupId } = await create(t.ada);
    const before = await seqOf(groupId);
    const attempts: Record<string, unknown>[] = [
      { op: 'group.read', groupId },
      { op: 'group.rename', groupId, sealed: await sealedName(groupId, 'Mine now') },
      { op: 'group.recolour', groupId, color: '#dc2626' },
      { op: 'group.currency', groupId, defaultCurrency: 'USD' },
      { op: 'group.simplify', groupId, on: true },
      { op: 'member.notify', groupId, notify: 'none' },
    ];
    const adaMember = (
      (await (await call(t.ada, { op: 'group.read', groupId })).json()) as {
        me: { memberId: string };
      }
    ).me.memberId;
    attempts.push({ op: 'member.role', groupId, memberId: adaMember, role: 'member' });
    for (const body of attempts) {
      const reply = await call(t.grace, body);
      expect(reply.status, String(body.op)).toBe(404);
      expect(await reply.text(), String(body.op)).toBe('');
    }
    expect(await seqOf(groupId)).toBe(before);
    const state = await (await call(t.ada, { op: 'group.read', groupId })).json();
    expect(state.group).toMatchObject({
      color: '#2563eb',
      defaultCurrency: 'EUR',
      simplifyDebts: false,
    });
    expect(state.me.role).toBe('owner');
  });

  it('is changed by an owner, each change moving its order on', async () => {
    const { groupId } = await create(t.ada);
    const renamed = await sealedName(groupId, 'Lisbon 2026');
    const steps: [Record<string, unknown>, (g: Record<string, unknown>) => void][] = [
      [{ op: 'group.rename', groupId, sealed: renamed }, (g) => expect(g.sealed).toBe(renamed)],
      [{ op: 'group.recolour', groupId, color: '#16a34a' }, (g) => expect(g.color).toBe('#16a34a')],
      [
        { op: 'group.currency', groupId, defaultCurrency: 'JPY' },
        (g) => expect(g.defaultCurrency).toBe('JPY'),
      ],
      [{ op: 'group.simplify', groupId, on: true }, (g) => expect(g.simplifyDebts).toBe(true)],
    ];
    let seq = await seqOf(groupId);
    for (const [body, check] of steps) {
      const reply = await call(t.ada, body);
      expect(reply.status, String(body.op)).toBe(200);
      check((await reply.json()).group);
      const next = await seqOf(groupId);
      expect(next).toBe((seq ?? 0) + 1);
      seq = next;
    }
  });

  it('lets a member read it and choose what they hear, and not change it: that is an owner’s', async () => {
    const { groupId } = await create(t.ada);
    await addMember(groupId, t.grace);
    const read = await call(t.grace, { op: 'group.read', groupId });
    expect(read.status).toBe(200);
    const state = await read.json();
    expect(state.me.role).toBe('member');
    // A member does not see another member's email; an owner does (DESIGN.md §6.1).
    expect(state.members.find((m: { name: string }) => m.name === 'Ada').email).toBeNull();
    expect(state.members.find((m: { name: string }) => m.name === 'Grace').email).toBe(
      'grace@example.com',
    );
    const asOwner = await (await call(t.ada, { op: 'group.read', groupId })).json();
    expect(asOwner.members.find((m: { name: string }) => m.name === 'Grace').email).toBe(
      'grace@example.com',
    );

    expect((await call(t.grace, { op: 'group.recolour', groupId, color: '#dc2626' })).status).toBe(
      404,
    );
    const quiet = await call(t.grace, { op: 'member.notify', groupId, notify: 'involved' });
    expect(quiet.status).toBe(200);
    expect((await quiet.json()).me.notify).toBe('involved');
    // Ada's choice is her own and unchanged.
    expect((await (await call(t.ada, { op: 'group.read', groupId })).json()).me.notify).toBe('all');
  });

  it('always has an owner: the last one cannot step down until another is one', async () => {
    const { groupId } = await create(t.ada);
    const graceMember = await addMember(groupId, t.grace);
    const adaMember = (
      (await (await call(t.ada, { op: 'group.read', groupId })).json()) as {
        me: { memberId: string };
      }
    ).me.memberId;

    const held = await call(t.ada, {
      op: 'member.role',
      groupId,
      memberId: adaMember,
      role: 'member',
    });
    expect(held.status).toBe(409);
    expect(await held.json()).toEqual({
      code: 'last_owner',
      message: 'A group always has an owner. Make someone else an owner first.',
    });

    expect(
      (await call(t.ada, { op: 'member.role', groupId, memberId: graceMember, role: 'owner' }))
        .status,
    ).toBe(200);
    expect(
      (await call(t.ada, { op: 'member.role', groupId, memberId: adaMember, role: 'member' }))
        .status,
    ).toBe(200);
    // Now Grace is the last owner, and Ada, a member, cannot change roles at all.
    expect(
      (await call(t.grace, { op: 'member.role', groupId, memberId: graceMember, role: 'member' }))
        .status,
    ).toBe(409);
    expect(
      (await call(t.ada, { op: 'member.role', groupId, memberId: adaMember, role: 'owner' }))
        .status,
    ).toBe(404);
  });

  it('gives a placeholder no role, and a member of another group none here', async () => {
    const { groupId } = await create(t.ada);
    const placeholder = crypto.randomUUID();
    await dbRun(
      t.database,
      sql`INSERT INTO ${tables(t.database).person} (id, name, added_by, created_at, updated_at) VALUES (${placeholder}, 'Sam', NULL, 1, 1)`,
    );
    const memberId = crypto.randomUUID();
    await dbRun(
      t.database,
      sql`INSERT INTO ${tables(t.database).member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
          VALUES (${memberId}, ${groupId}, ${placeholder}, NULL, 'all', NULL, 1, NULL, 1)`,
    );
    expect(
      (await call(t.ada, { op: 'member.role', groupId, memberId, role: 'owner' })).status,
    ).toBe(404);
    const { groupId: other } = await create(t.ada);
    expect(
      (await call(t.ada, { op: 'member.role', groupId: other, memberId, role: 'owner' })).status,
    ).toBe(404);
  });

  it('refuses what is not a group: a colour, a currency or an id that is not one, a name that is not sealed, or a later epoch', async () => {
    const groupId = crypto.randomUUID();
    const bad: Record<string, unknown>[] = [
      { color: 'red' },
      { defaultCurrency: 'XYZ' },
      { groupId: 'not-a-uuid' },
      { sealed: 'Lisbon' },
      { sealed: await sealedName(groupId, 'Lisbon', 2), groupId },
      { keyWrap: 'not a wrap' },
    ];
    for (const extra of bad)
      expect((await create(t.ada, extra)).reply.status, JSON.stringify(extra)).toBe(400);
    expect((await call(t.ada, { op: 'nothing.at.all' })).status).toBe(400);
  });

  it('refuses an id that is another group’s', async () => {
    const { groupId } = await create(t.ada);
    const reply = await create(t.grace, { groupId, sealed: await sealedName(groupId, 'Mine') });
    expect(reply.reply.status).toBe(409);
    expect((await call(t.grace, { op: 'group.read', groupId })).status).toBe(404);
  });

  it('takes no change once closed but its reopening, which is task 3.3’s', async () => {
    const { groupId } = await create(t.ada);
    await dbRun(
      t.database,
      sql`UPDATE ${tables(t.database).grp} SET closed_at = 1 WHERE id = ${groupId}`,
    );
    expect((await call(t.ada, { op: 'group.recolour', groupId, color: '#dc2626' })).status).toBe(
      404,
    );
    expect((await call(t.ada, { op: 'group.read', groupId })).status).toBe(200);
  });

  it(`stops a person at ${MAX_GROUPS} groups, with a sentence`, async () => {
    const person = await personOfAccount(t.database, t.grace.id);
    const existing = await dbGet<{ n: number }>(
      t.database,
      sql`SELECT COUNT(*) AS n FROM ${tables(t.database).member} WHERE person_id = ${person?.id ?? ''} AND left_at IS NULL`,
    );
    for (let i = Number(existing?.n ?? 0); i < MAX_GROUPS; i++) {
      await dbRun(
        t.database,
        sql`INSERT INTO ${tables(t.database).member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
            VALUES (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${person?.id ?? ''}, 'member', 'all', NULL, 1, NULL, 1)`,
      );
    }
    const { reply } = await create(t.grace);
    expect(reply.status).toBe(409);
    expect((await reply.json()).message).toMatch(/200 groups/);
  });
});
