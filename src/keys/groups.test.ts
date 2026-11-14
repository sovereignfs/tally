import 'fake-indexeddb/auto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type Person, type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { openVault } from '../cipher/vault';
import { dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { opsHandler } from '../groups/api';
import { personOfAccount } from '../people/persons';
import { keyHandlers } from './api';
import { storeGrants } from './grants';
import { GroupKeys, type GrantsApi } from './groups';
import { AccountKeys, type KeyApi, type ServerKeys } from './unlock';

/**
 * A group's key reaching its members (DESIGN.md §5.3), end to end: each person's device is the browser's own code (`AccountKeys`, `GroupKeys`, real
 * crypto, a vault of its own), talking to the real routes over the real database, as two accounts. Nobody does anything for a member to read the group.
 */
const { leg } = testTarget();

describe(`a group's key (${leg})`, () => {
  let t: TwoAccounts;
  type Handler = (
    request: Request,
    context?: { params?: Promise<Record<string, string>> },
  ) => Promise<Response>;
  let route: Record<
    'get' | 'create' | 'replace' | 'putWrap' | 'groupGrants' | 'putGroupGrants' | 'ops',
    Handler
  >;

  const send = async (
    handler: Handler,
    who: Person,
    method: string,
    body?: unknown,
    params: Record<string, string> = {},
  ) => handler(t.request(who, '/api/x', { method, body }), { params: Promise.resolve(params) });

  /** A device of a person: the browser's key code, over the routes as that person. */
  async function deviceOf(who: Person) {
    const api: KeyApi = {
      get: async () => (await (await send(route.get, who, 'GET')).json()) as ServerKeys,
      create: async (publicKey, wraps) => {
        const reply = await send(route.create, who, 'POST', { publicKey, wraps });
        return reply.status === 409 ? 'exists' : ((await reply.json()) as { version: number });
      },
      replace: async (expectedVersion, publicKey, wraps) =>
        (await (
          await send(route.replace, who, 'PUT', { expectedVersion, publicKey, wraps })
        ).json()) as { version: number },
      putWrap: async (version, wrap) =>
        void (await send(route.putWrap, who, 'POST', { version, wrap })),
      createRequest: async () => '',
      getRequest: async () => null,
      approveRequest: async () => undefined,
      deleteRequest: async () => undefined,
    };
    const grants: GrantsApi = {
      get: async () => (await send(route.groupGrants, who, 'GET')).json(),
      put: async (list) => (await send(route.putGroupGrants, who, 'POST', { grants: list })).json(),
    };
    const account = new AccountKeys(
      who.id,
      api,
      await openVault(`${who.id}-${crypto.randomUUID()}`),
    );
    return { account, groups: new GroupKeys(account, grants) };
  }

  const ops = (who: Person, body: Record<string, unknown>) => send(route.ops, who, 'POST', body);

  async function addMember(groupId: string, who: Person) {
    const person = await personOfAccount(t.database, who.id);
    await dbRun(
      t.database,
      sql`INSERT INTO ${tables(t.database).member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
          VALUES (${crypto.randomUUID()}, ${groupId}, ${person?.id ?? ''}, 'member', 'all', NULL, ${Date.now()}, NULL, 1)`,
    );
  }

  beforeAll(async () => {
    t = await twoAccounts();
    const keys = keyHandlers(async () => t.database);
    route = {
      get: accountRoute(keys.get, t.deps),
      create: accountRoute(keys.create, t.deps),
      replace: accountRoute(keys.replace, t.deps),
      putWrap: accountRoute(keys.putWrap, t.deps),
      groupGrants: accountRoute(keys.groupGrants, t.deps),
      putGroupGrants: accountRoute(keys.putGroupGrants, t.deps),
      ops: accountRoute(
        opsHandler(async () => t.database),
        t.deps,
      ),
    };
  });
  afterAll(async () => t.close());

  it('reaches a new member by itself, at the next exchange of any member’s device, and is never readable by the server', async () => {
    const ada = await deviceOf(t.ada);
    expect(await ada.account.afterPassword(new Uint8Array(32).fill(1))).toBe('unlocked');
    const prepared = await ada.groups.prepareGroup('Lisbon');
    const made = await ops(t.ada, {
      op: 'group.create',
      ...prepared,
      color: '#2563eb',
      defaultCurrency: 'EUR',
    });
    expect(made.status).toBe(201);
    const { group } = (await made.json()) as { group: { id: string; sealed: string } };
    expect(await ada.groups.openName(group)).toBe('Lisbon');
    expect(group.sealed).not.toContain('Lisbon');

    const grace = await deviceOf(t.grace);
    expect(await grace.account.afterPassword(new Uint8Array(32).fill(2))).toBe('unlocked');
    // Before she is a member, a wrap for her is refused, whoever makes it.
    expect(await ada.groups.sync()).toEqual({ opened: 0, granted: 0 });

    await addMember(group.id, t.grace);
    const asGrace = (await (
      await ops(t.grace, { op: 'group.read', groupId: group.id })
    ).json()) as { group: { id: string; sealed: string } };
    // The group is there for her, its words not yet: "…".
    expect(await grace.groups.openName(asGrace.group)).toBeUndefined();
    expect(await grace.groups.sync()).toEqual({ opened: 0, granted: 0 });

    // Ada's device, at its next exchange, wraps the key for her; Grace's, at hers, opens it.
    expect(await ada.groups.sync()).toEqual({ opened: 0, granted: 1 });
    expect(await grace.groups.sync()).toEqual({ opened: 1, granted: 0 });
    expect(await grace.groups.openName(asGrace.group)).toBe('Lisbon');
    // And nothing more to do on either side.
    expect(await ada.groups.sync()).toEqual({ opened: 0, granted: 0 });
  });

  it('reaches an account whose key was replaced, again by itself', async () => {
    const ada = await deviceOf(t.ada);
    await ada.account.afterPassword(new Uint8Array(32).fill(1));
    const prepared = await ada.groups.prepareGroup('Roomies');
    const { group } = (await (
      await ops(t.ada, {
        op: 'group.create',
        ...prepared,
        color: '#16a34a',
        defaultCurrency: 'GBP',
      })
    ).json()) as {
      group: { id: string; sealed: string };
    };
    await addMember(group.id, t.grace);
    const grace = await deviceOf(t.grace);
    await grace.account.afterPassword(new Uint8Array(32).fill(2));
    await ada.groups.sync();
    await grace.groups.sync();
    expect(await grace.groups.openName(group)).toBe('Roomies');

    // Grace lost every way in and started afresh on a new device: her old wraps are gone, and the new device reads nothing yet.
    const fresh = await deviceOf(t.grace);
    await fresh.account.startAfresh(new Uint8Array(32).fill(3));
    await fresh.groups.sync();
    expect(await fresh.groups.openName(group)).toBeUndefined();
    // Ada's device wraps every group she shares with Grace for the new key, and Grace's new device opens them.
    const granted = await ada.groups.sync();
    expect(granted.granted).toBeGreaterThanOrEqual(1);
    await fresh.groups.sync();
    expect(await fresh.groups.openName(group)).toBe('Roomies');
  });

  it('is never stored for someone who is not in the group, or from someone who does not hold it', async () => {
    const ada = await deviceOf(t.ada);
    await ada.account.afterPassword(new Uint8Array(32).fill(1));
    const prepared = await ada.groups.prepareGroup('Ski');
    const { group } = (await (
      await ops(t.ada, {
        op: 'group.create',
        ...prepared,
        color: '#7c3aed',
        defaultCurrency: 'CHF',
      })
    ).json()) as {
      group: { id: string };
    };
    const wrapped = `h1.${'Z'.repeat(60)}`;
    // Ada, a member who holds it, for Grace, who is not in the group.
    expect(
      await storeGrants(t.database, t.ada.id, [
        { groupId: group.id, epoch: 1, accountId: t.grace.id, wrapped },
      ]),
    ).toEqual({ accepted: 0, refused: 1 });
    // Grace, not a member, for herself, through the route.
    const reply = await send(route.putGroupGrants, t.grace, 'POST', {
      grants: [{ groupId: group.id, epoch: 1, accountId: t.grace.id, wrapped }],
    });
    expect(await reply.json()).toEqual({ accepted: 0, refused: 1 });
    // And an epoch Ada does not hold, for a member.
    await addMember(group.id, t.grace);
    expect(
      await storeGrants(t.database, t.ada.id, [
        { groupId: group.id, epoch: 2, accountId: t.grace.id, wrapped },
      ]),
    ).toEqual({ accepted: 0, refused: 1 });
    // What Grace is told of: nothing of a group she is not in, and of this one, only once she is a member.
    const asGrace = (await (await send(route.groupGrants, t.grace, 'GET')).json()) as {
      wraps: { groupId: string }[];
    };
    expect(asGrace.wraps.filter((w) => w.groupId === group.id)).toEqual([]);
  });
});
