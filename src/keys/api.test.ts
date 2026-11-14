import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type Person, type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { testTarget } from '../db/test-support';
import { keyHandlers } from './api';
import { REQUEST_TTL_MS, createRequest, requestOf } from './store';

/**
 * An account's key over its routes (DESIGN.md §5.3), with two real accounts: everything one account can do with its own, and that everything of
 * Ada's reads as not there to Grace, by her session, whatever she names.
 */
const { leg } = testTarget();

const pk = (fill: string) => fill.repeat(43).slice(0, 43);
const wrapped = (tag: string) => `w1.${tag.padEnd(48, 'A')}`;
const toPublic = (tag: string) => `h1.${tag.padEnd(48, 'B')}`;

describe(`an account's key (${leg})`, () => {
  let t: TwoAccounts;
  let route: ReturnType<typeof routes>;

  const routes = () => {
    const keys = keyHandlers(async () => t.database);
    return {
      get: accountRoute(keys.get, t.deps),
      create: accountRoute(keys.create, t.deps),
      replace: accountRoute(keys.replace, t.deps),
      putWrap: accountRoute(keys.putWrap, t.deps),
      deleteWrap: accountRoute(keys.deleteWrap, t.deps),
      createRequest: accountRoute(keys.createRequest, t.deps),
      getRequest: accountRoute(keys.getRequest, t.deps),
      approveRequest: accountRoute(keys.approveRequest, t.deps),
      deleteRequest: accountRoute(keys.deleteRequest, t.deps),
    };
  };
  const call = (
    handler: (
      request: Request,
      context?: { params?: Promise<Record<string, string>> },
    ) => Promise<Response>,
    who: Person,
    method: string,
    body?: unknown,
    params: Record<string, string> = {},
  ) => handler(t.request(who, '/api/keys', { method, body }), { params: Promise.resolve(params) });
  const keysOf = async (who: Person) => (await call(route.get, who, 'GET')).json();

  beforeAll(async () => {
    t = await twoAccounts();
    route = routes();
  });
  afterAll(async () => t.close());

  it('is made once, with its first wraps, and a second making is refused rather than replacing it', async () => {
    expect(await keysOf(t.ada)).toEqual({ accountKey: null, wraps: [], requests: [] });
    const made = await call(route.create, t.ada, 'POST', {
      publicKey: pk('a'),
      wraps: [{ method: 'password', params: 'argon2id:1', wrapped: wrapped('pw') }],
    });
    expect(made.status).toBe(201);
    expect(await made.json()).toEqual({ publicKey: pk('a'), version: 1 });
    const again = await call(route.create, t.ada, 'POST', { publicKey: pk('z'), wraps: [] });
    expect(again.status).toBe(409);
    const now = await keysOf(t.ada);
    expect(now.accountKey).toEqual({ publicKey: pk('a'), version: 1 });
    expect(now.wraps).toEqual([
      expect.objectContaining({
        method: 'password',
        params: 'argon2id:1',
        wrapped: wrapped('pw'),
        version: 1,
      }),
    ]);
  });

  it('is Ada’s alone: Grace sees none of it, and changes none of it', async () => {
    expect(await keysOf(t.grace)).toEqual({ accountKey: null, wraps: [], requests: [] });
    const adaWrap = (await keysOf(t.ada)).wraps[0].id as string;
    expect(
      (await call(route.deleteWrap, t.grace, 'DELETE', undefined, { id: adaWrap })).status,
    ).toBe(404);
    expect(
      (
        await call(route.putWrap, t.grace, 'POST', {
          version: 1,
          wrap: { method: 'recovery', wrapped: wrapped('x') },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(route.replace, t.grace, 'PUT', {
          expectedVersion: 1,
          publicKey: pk('g'),
          wraps: [],
        })
      ).status,
    ).toBe(404);
    expect((await keysOf(t.ada)).wraps).toHaveLength(1);
  });

  it('keeps one password wrap and one recovery wrap, and one for each passkey', async () => {
    for (const tag of ['pw2', 'pw3']) {
      expect(
        (
          await call(route.putWrap, t.ada, 'POST', {
            version: 1,
            wrap: { method: 'password', params: 'argon2id:1', wrapped: wrapped(tag) },
          })
        ).status,
      ).toBe(201);
    }
    await call(route.putWrap, t.ada, 'POST', {
      version: 1,
      wrap: { method: 'recovery', wrapped: wrapped('rc') },
    });
    for (const credentialId of ['credential-one', 'credential-two', 'credential-one']) {
      await call(route.putWrap, t.ada, 'POST', {
        version: 1,
        wrap: { method: 'passkey', credentialId, wrapped: wrapped(credentialId.slice(-3)) },
      });
    }
    const wraps = (await keysOf(t.ada)).wraps as {
      method: string;
      credentialId: string | null;
      wrapped: string;
    }[];
    expect(wraps.filter((w) => w.method === 'password').map((w) => w.wrapped)).toEqual([
      wrapped('pw3'),
    ]);
    expect(wraps.filter((w) => w.method === 'recovery')).toHaveLength(1);
    expect(
      wraps
        .filter((w) => w.method === 'passkey')
        .map((w) => w.credentialId)
        .sort(),
    ).toEqual(['credential-one', 'credential-two']);
    // A wrap of a version that is not the key's is refused.
    expect(
      (
        await call(route.putWrap, t.ada, 'POST', {
          version: 7,
          wrap: { method: 'recovery', wrapped: wrapped('old') },
        })
      ).status,
    ).toBe(404);
  });

  it('refuses what is not a key or a wrap, and a device wrap made by any way but a request', async () => {
    const bad = [
      { version: 1, wrap: { method: 'password', wrapped: 'plain text' } },
      { version: 1, wrap: { method: 'telepathy', wrapped: wrapped('t') } },
      { version: 1, wrap: { method: 'passkey', wrapped: wrapped('t') } },
      {
        version: 1,
        wrap: { method: 'recovery', credentialId: 'credential-x', wrapped: wrapped('t') },
      },
      { version: 1, wrap: { method: 'device', wrapped: wrapped('t') } },
    ];
    for (const body of bad)
      expect((await call(route.putWrap, t.ada, 'POST', body)).status, JSON.stringify(body)).toBe(
        400,
      );
    expect(
      (await call(route.create, t.grace, 'POST', { publicKey: 'short', wraps: [] })).status,
    ).toBe(400);
  });

  describe('a new device', () => {
    it('asks, is allowed by another device of the account, takes its wrap, and the request is gone', async () => {
      const asked = await call(route.createRequest, t.ada, 'POST', {
        publicKey: pk('n'),
        label: '  Safari   on iPhone ',
      });
      expect(asked.status).toBe(201);
      const { id } = (await asked.json()) as { id: string };
      expect((await keysOf(t.ada)).requests).toEqual([
        expect.objectContaining({ id, publicKey: pk('n'), label: 'Safari on iPhone' }),
      ]);
      expect(
        await (await call(route.getRequest, t.ada, 'GET', undefined, { id })).json(),
      ).toMatchObject({ wrapped: null });

      expect(
        (await call(route.approveRequest, t.ada, 'POST', { wrapped: toPublic('dev') }, { id }))
          .status,
      ).toBe(204);
      // Once: a second approval is refused, and an allowed request no longer waits.
      expect(
        (await call(route.approveRequest, t.ada, 'POST', { wrapped: toPublic('again') }, { id }))
          .status,
      ).toBe(404);
      expect((await keysOf(t.ada)).requests).toEqual([]);
      expect(
        await (await call(route.getRequest, t.ada, 'GET', undefined, { id })).json(),
      ).toMatchObject({ wrapped: toPublic('dev') });

      expect((await call(route.deleteRequest, t.ada, 'DELETE', undefined, { id })).status).toBe(
        204,
      );
      expect((await call(route.getRequest, t.ada, 'GET', undefined, { id })).status).toBe(404);
    });

    it('is Ada’s request alone: Grace cannot see it, allow it or take it', async () => {
      const { id } = (await (
        await call(route.createRequest, t.ada, 'POST', { publicKey: pk('m'), label: 'Laptop' })
      ).json()) as { id: string };
      expect((await keysOf(t.grace)).requests).toEqual([]);
      expect((await call(route.getRequest, t.grace, 'GET', undefined, { id })).status).toBe(404);
      expect(
        (await call(route.approveRequest, t.grace, 'POST', { wrapped: toPublic('g') }, { id }))
          .status,
      ).toBe(404);
      await call(route.deleteRequest, t.grace, 'DELETE', undefined, { id });
      expect((await call(route.getRequest, t.ada, 'GET', undefined, { id })).status).toBe(200);
      await call(route.deleteRequest, t.ada, 'DELETE', undefined, { id });
    });

    it('waits ten minutes and no longer, and an account cannot have more than five waiting', async () => {
      const id = await createRequest(t.database, t.grace.id, pk('e'), 'Old', 1_000);
      await expect(
        requestOf(t.database, t.grace.id, id, 1_000 + REQUEST_TTL_MS + 1),
      ).rejects.toThrow('not_found');
      for (let i = 0; i < 5; i++) {
        expect(
          (await call(route.createRequest, t.grace, 'POST', { publicKey: pk('f'), label: `D${i}` }))
            .status,
        ).toBe(201);
      }
      expect(
        (
          await call(route.createRequest, t.grace, 'POST', {
            publicKey: pk('f'),
            label: 'one too many',
          })
        ).status,
      ).toBe(429);
    });
  });

  it('is replaced as a last resort: a new version, and every wrap of the old one gone; a stale replacement is refused', async () => {
    const replaced = await call(route.replace, t.ada, 'PUT', {
      expectedVersion: 1,
      publicKey: pk('r'),
      wraps: [{ method: 'password', params: 'argon2id:1', wrapped: wrapped('new') }],
    });
    expect(await replaced.json()).toEqual({ publicKey: pk('r'), version: 2 });
    const now = await keysOf(t.ada);
    expect(now.wraps).toEqual([
      expect.objectContaining({ method: 'password', version: 2, wrapped: wrapped('new') }),
    ]);
    // Another device that saw version 1 cannot replace version 2.
    expect(
      (
        await call(route.replace, t.ada, 'PUT', {
          expectedVersion: 1,
          publicKey: pk('s'),
          wraps: [],
        })
      ).status,
    ).toBe(404);
  });

  it('asks for a session, and Origin on a write, like every account route', async () => {
    expect((await route.get(t.request(null, '/api/keys'))).status).toBe(401);
    const noOrigin = await route.create(
      t.request(t.grace, '/api/keys', {
        method: 'POST',
        body: { publicKey: pk('o'), wraps: [] },
        headers: { origin: '' },
      }),
    );
    expect(noOrigin.status).toBe(403);
    expect((await keysOf(t.grace)).accountKey).toBeNull();
  });
});
