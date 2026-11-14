import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet, dbRun, transaction } from '../db/exec';
import { tables } from '../db/tables';

/**
 * The server's side of an account's key (DESIGN.md §5.3): it keeps the public half, the wraps of the private half and new devices' requests, and opens
 * none of them. **Every statement names the account the session belongs to**, so one account cannot read or change another's; a row of another
 * account reads as not there. The forms are checked here (a public key is 32 bytes of base64url, a wrap is `h1.` or `w1.`), and sizes are bounded.
 */
export const METHODS = ['password', 'passkey', 'recovery', 'device'] as const;
export type WrapMethod = (typeof METHODS)[number];

/** A new device's request is good for ten minutes. */
export const REQUEST_TTL_MS = 10 * 60 * 1000;
/** At most this many requests waiting for one account, so that a stolen session cannot fill the table. */
export const MAX_PENDING_REQUESTS = 5;
/** At most this many wraps for one account: a password, a recovery code, and passkeys. */
export const MAX_WRAPS = 20;

const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
const WRAPPED = /^(h1|w1)\.[A-Za-z0-9_-]{40,400}$/;
const CREDENTIAL = /^[A-Za-z0-9_-]{8,512}$/;
const PARAMS = /^[a-z0-9.:=,-]{1,64}$/;

export class KeyError extends Error {
  constructor(readonly code: 'invalid' | 'not_found' | 'exists' | 'too_many') {
    super(`keys: ${code}`);
    this.name = 'KeyError';
  }
}

export interface AccountKey {
  publicKey: string;
  version: number;
}

export interface Wrap {
  id: string;
  version: number;
  method: WrapMethod;
  credentialId: string | null;
  params: string | null;
  wrapped: string;
}

export interface NewWrap {
  method: WrapMethod;
  credentialId?: string | null;
  params?: string | null;
  wrapped: string;
}

export interface KeyRequest {
  id: string;
  publicKey: string;
  label: string;
  wrapped: string | null;
  createdAt: number;
  expiresAt: number;
}

export function checkPublicKey(value: unknown): string {
  if (typeof value !== 'string' || !PUBLIC_KEY.test(value)) throw new KeyError('invalid');
  return value;
}

export function checkWrapped(value: unknown): string {
  if (typeof value !== 'string' || !WRAPPED.test(value)) throw new KeyError('invalid');
  return value;
}

export function checkNewWrap(value: unknown): NewWrap {
  const wrap = (value ?? {}) as Record<string, unknown>;
  const method = wrap.method;
  if (typeof method !== 'string' || !(METHODS as readonly string[]).includes(method))
    throw new KeyError('invalid');
  const credentialId = wrap.credentialId ?? null;
  const params = wrap.params ?? null;
  // A passkey's wrap names its credential, and nothing else does; a password's says the version of its parameters.
  if ((method === 'passkey') !== (typeof credentialId === 'string')) throw new KeyError('invalid');
  if (credentialId !== null && (typeof credentialId !== 'string' || !CREDENTIAL.test(credentialId)))
    throw new KeyError('invalid');
  if (params !== null && (typeof params !== 'string' || !PARAMS.test(params)))
    throw new KeyError('invalid');
  if (method === 'device') throw new KeyError('invalid');
  return {
    method: method as WrapMethod,
    credentialId: credentialId as string | null,
    params: params as string | null,
    wrapped: checkWrapped(wrap.wrapped),
  };
}

export async function accountKeyOf(
  database: Database,
  accountId: string,
): Promise<AccountKey | undefined> {
  return dbGet<AccountKey>(
    database,
    sql`SELECT public_key AS "publicKey", version FROM ${tables(database).accountKey} WHERE account_id = ${accountId}`,
  );
}

export async function wrapsOf(database: Database, accountId: string): Promise<Wrap[]> {
  return dbAll<Wrap>(
    database,
    sql`SELECT id, version, method, credential_id AS "credentialId", params, wrapped FROM ${tables(database).accountKeyWrap}
        WHERE account_id = ${accountId} ORDER BY created_at, id`,
  );
}

async function insertWrap(
  db: Database,
  accountId: string,
  version: number,
  wrap: NewWrap,
  now: number,
) {
  await dbRun(
    db,
    sql`INSERT INTO ${tables(db).accountKeyWrap} (id, account_id, version, method, credential_id, params, wrapped, created_at)
        VALUES (${crypto.randomUUID()}, ${accountId}, ${version}, ${wrap.method}, ${wrap.credentialId ?? null}, ${wrap.params ?? null},
                ${wrap.wrapped}, ${now})`,
  );
}

/**
 * Makes the account's key, version 1, with its first wraps, **once**: an account that has a key is refused (`exists`), so a second device that
 * signed in at the same moment cannot replace the first's key. That device then unwraps the one that was made.
 */
export async function createAccountKey(
  database: Database,
  accountId: string,
  publicKey: string,
  wraps: readonly NewWrap[],
  now = Date.now(),
): Promise<AccountKey> {
  checkPublicKey(publicKey);
  if (wraps.length > MAX_WRAPS) throw new KeyError('too_many');
  return transaction(database, async (tx) => {
    const made = await dbAll<{ version: number }>(
      tx,
      sql`INSERT INTO ${tables(tx).accountKey} (account_id, public_key, version, created_at, updated_at)
          VALUES (${accountId}, ${publicKey}, 1, ${now}, ${now})
          ON CONFLICT (account_id) DO NOTHING RETURNING version`,
    );
    if (made.length === 0) throw new KeyError('exists');
    for (const wrap of wraps) await insertWrap(tx, accountId, 1, wrap, now);
    return { publicKey, version: 1 };
  });
}

/**
 * **The last resort** (DESIGN.md §5.3): no way in is left, so the account gets a new key, the next version, and every wrap of the old one goes. What it
 * could open stays sealed until a group's members wrap the group's key to the new one (task 15.3). `expectedVersion` is the version the device saw:
 * if another device replaced the key meanwhile, this one is refused rather than replacing that.
 */
export async function replaceAccountKey(
  database: Database,
  accountId: string,
  expectedVersion: number,
  publicKey: string,
  wraps: readonly NewWrap[],
  now = Date.now(),
): Promise<AccountKey> {
  checkPublicKey(publicKey);
  if (!Number.isSafeInteger(expectedVersion) || wraps.length > MAX_WRAPS)
    throw new KeyError('invalid');
  return transaction(database, async (tx) => {
    const next = expectedVersion + 1;
    const moved = await dbAll<{ version: number }>(
      tx,
      sql`UPDATE ${tables(tx).accountKey} SET public_key = ${publicKey}, version = ${next}, updated_at = ${now}
          WHERE account_id = ${accountId} AND version = ${expectedVersion} RETURNING version`,
    );
    if (moved.length === 0) throw new KeyError('not_found');
    await dbRun(tx, sql`DELETE FROM ${tables(tx).accountKeyWrap} WHERE account_id = ${accountId}`);
    // The group keys wrapped to the old key open nothing now: gone, so that the account is one a group's members wrap them to again (§5.3).
    await dbRun(tx, sql`DELETE FROM ${tables(tx).keyWrap} WHERE account_id = ${accountId}`);
    for (const wrap of wraps) await insertWrap(tx, accountId, next, wrap, now);
    return { publicKey, version: next };
  });
}

/**
 * Adds a wrap of the current key: a password's after it is changed, a passkey's once it has unlocked, a recovery code's. **One of each** password and
 * recovery wrap, and one for each passkey: a new one replaces the old one of its kind, in the same transaction.
 */
export async function putWrap(
  database: Database,
  accountId: string,
  version: number,
  wrap: NewWrap,
  now = Date.now(),
): Promise<string> {
  return transaction(database, async (tx) => {
    const key = await dbGet<{ version: number }>(
      tx,
      sql`SELECT version FROM ${tables(tx).accountKey} WHERE account_id = ${accountId} AND version = ${version}`,
    );
    if (!key) throw new KeyError('not_found');
    if (wrap.method === 'passkey') {
      await dbRun(
        tx,
        sql`DELETE FROM ${tables(tx).accountKeyWrap} WHERE account_id = ${accountId} AND method = 'passkey'
            AND credential_id = ${wrap.credentialId ?? ''}`,
      );
    } else {
      await dbRun(
        tx,
        sql`DELETE FROM ${tables(tx).accountKeyWrap} WHERE account_id = ${accountId} AND method = ${wrap.method}`,
      );
    }
    const count = await dbGet<{ n: number }>(
      tx,
      sql`SELECT COUNT(*) AS n FROM ${tables(tx).accountKeyWrap} WHERE account_id = ${accountId}`,
    );
    if (Number(count?.n ?? 0) >= MAX_WRAPS) throw new KeyError('too_many');
    const id = crypto.randomUUID();
    await dbRun(
      tx,
      sql`INSERT INTO ${tables(tx).accountKeyWrap} (id, account_id, version, method, credential_id, params, wrapped, created_at)
          VALUES (${id}, ${accountId}, ${version}, ${wrap.method}, ${wrap.credentialId ?? null}, ${wrap.params ?? null}, ${wrap.wrapped}, ${now})`,
    );
    return id;
  });
}

/** Deletes one of the account's wraps (a passkey removed); another account's reads as not there. */
export async function deleteWrap(database: Database, accountId: string, id: string): Promise<void> {
  const gone = await dbAll<{ id: string }>(
    database,
    sql`DELETE FROM ${tables(database).accountKeyWrap} WHERE id = ${id} AND account_id = ${accountId} RETURNING id`,
  );
  if (gone.length === 0) throw new KeyError('not_found');
}

/** A new device asks for the key: its one-time public key and how it describes itself ("Safari on iPhone"). */
export async function createRequest(
  database: Database,
  accountId: string,
  publicKey: string,
  label: string,
  now = Date.now(),
): Promise<string> {
  checkPublicKey(publicKey);
  const name = label.trim().replace(/\s+/g, ' ').slice(0, 80) || 'A new device';
  return transaction(database, async (tx) => {
    await dbRun(
      tx,
      sql`DELETE FROM ${tables(tx).keyRequest} WHERE account_id = ${accountId} AND expires_at <= ${now}`,
    );
    const pending = await dbGet<{ n: number }>(
      tx,
      sql`SELECT COUNT(*) AS n FROM ${tables(tx).keyRequest} WHERE account_id = ${accountId}`,
    );
    if (Number(pending?.n ?? 0) >= MAX_PENDING_REQUESTS) throw new KeyError('too_many');
    const id = crypto.randomUUID();
    await dbRun(
      tx,
      sql`INSERT INTO ${tables(tx).keyRequest} (id, account_id, public_key, label, wrapped, created_at, expires_at)
          VALUES (${id}, ${accountId}, ${publicKey}, ${name}, NULL, ${now}, ${now + REQUEST_TTL_MS})`,
    );
    return id;
  });
}

const REQUEST_COLUMNS = sql`id, public_key AS "publicKey", label, wrapped, created_at AS "createdAt", expires_at AS "expiresAt"`;

/** The account's requests still waiting to be allowed, for its unlocked devices to offer. */
export async function pendingRequests(
  database: Database,
  accountId: string,
  now = Date.now(),
): Promise<KeyRequest[]> {
  return dbAll<KeyRequest>(
    database,
    sql`SELECT ${REQUEST_COLUMNS} FROM ${tables(database).keyRequest}
        WHERE account_id = ${accountId} AND wrapped IS NULL AND expires_at > ${now} ORDER BY created_at, id`,
  );
}

export async function requestOf(
  database: Database,
  accountId: string,
  id: string,
  now = Date.now(),
): Promise<KeyRequest> {
  const found = await dbGet<KeyRequest>(
    database,
    sql`SELECT ${REQUEST_COLUMNS} FROM ${tables(database).keyRequest}
        WHERE id = ${id} AND account_id = ${accountId} AND expires_at > ${now}`,
  );
  if (!found) throw new KeyError('not_found');
  return found;
}

/** Another of the account's devices allows a request: the account key wrapped to the request's one-time key. Once. */
export async function approveRequest(
  database: Database,
  accountId: string,
  id: string,
  wrapped: string,
  now = Date.now(),
): Promise<void> {
  checkWrapped(wrapped);
  const done = await dbAll<{ id: string }>(
    database,
    sql`UPDATE ${tables(database).keyRequest} SET wrapped = ${wrapped}
        WHERE id = ${id} AND account_id = ${accountId} AND wrapped IS NULL AND expires_at > ${now} RETURNING id`,
  );
  if (done.length === 0) throw new KeyError('not_found');
}

/** Removes a request: declined, or taken by the device that made it. */
export async function deleteRequest(
  database: Database,
  accountId: string,
  id: string,
): Promise<void> {
  await dbRun(
    database,
    sql`DELETE FROM ${tables(database).keyRequest} WHERE id = ${id} AND account_id = ${accountId}`,
  );
}
