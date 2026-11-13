import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isBusy } from './busy';
import { createFileClient } from './client';

/**
 * **A write that waited out the busy timeout must not leave its client unable to write.** libSQL's file client, once a statement fails with
 * `SQLITE_BUSY` after its timeout, answers the next write on that connection as done and never saves it: no error, and the row is not on the disk
 * for any other connection. It needs a second process holding the write lock for longer than the timeout, which is what this test makes, with a
 * short timeout so that it is quick. The app's client replaces its connections when that happens (`client.ts`).
 *
 * It is about the file form and its driver alone, so it uses a file of its own whatever `TALLY_TEST_*` names.
 */
const ROOT = path.resolve(__dirname, '..', '..');

/** A second process that takes the write lock, says so, holds it for `ms`, and commits. */
function holdTheLock(file: string, ms: number): { held: Promise<void>; done: Promise<void> } {
  const script = `
    import { createClient } from '@libsql/client/node';
    const client = createClient({ url: 'file:' + process.argv[1], timeout: 5000 });
    const tx = await client.transaction('write');
    await tx.execute("UPDATE t SET v = 'held' WHERE id = 1");
    console.log('held');
    await new Promise((resolve) => setTimeout(resolve, ${ms}));
    await tx.commit();
    client.close();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, file], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const held = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('held')) resolve();
    });
    child.on('exit', () => reject(new Error('the holder ended before it held the lock')));
  });
  const done = new Promise<void>((resolve, reject) =>
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`the holder exited ${code}`)),
    ),
  );
  return { held, done };
}

describe('a database file shared with another process', () => {
  let folder: string;
  let file: string;

  beforeEach(async () => {
    folder = mkdtempSync(path.join(tmpdir(), 'tally-busy-'));
    file = path.join(folder, 'busy.db');
    const setup = await createFileClient(file);
    await setup.execute('PRAGMA journal_mode = WAL');
    await setup.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    await setup.execute("INSERT INTO t VALUES (1, 'a'), (2, 'a'), (3, 'a')");
    setup.close();
  });

  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('saves a write made after one that waited out the busy timeout and failed', async () => {
    const client = await createFileClient(file, 300);
    const holder = holdTheLock(file, 1200);
    await holder.held;

    await expect(client.execute("UPDATE t SET v = 'first' WHERE id = 2")).rejects.toMatchObject({
      code: expect.stringContaining('SQLITE_BUSY'),
    });
    await holder.done;

    await client.execute("UPDATE t SET v = 'second' WHERE id = 3");
    client.close();

    const reader = await createFileClient(file);
    const rows = await reader.execute('SELECT id, v FROM t ORDER BY id');
    reader.close();
    expect(rows.rows.map((row) => `${String(row.id)}=${String(row.v)}`)).toEqual([
      '1=held',
      '2=a',
      '3=second',
    ]);
  });

  it('saves a write made after a transaction that could not begin, as the app writes a change', async () => {
    const client = await createFileClient(file, 300);
    const holder = holdTheLock(file, 1200);
    await holder.held;

    await expect(client.transaction('write')).rejects.toSatisfy(isBusy);
    await holder.done;

    const tx = await client.transaction('write');
    await tx.execute("UPDATE t SET v = 'second' WHERE id = 3");
    await tx.commit();
    client.close();

    const reader = await createFileClient(file);
    const row = await reader.execute('SELECT v FROM t WHERE id = 3');
    reader.close();
    expect(row.rows[0]?.v).toBe('second');
  });
});

describe('a busy failure', () => {
  it('is told by its code, or by the code of what caused it, and nothing else is', () => {
    expect(isBusy(Object.assign(new Error('x'), { code: 'SQLITE_BUSY' }))).toBe(true);
    expect(isBusy(Object.assign(new Error('x'), { code: 'SQLITE_BUSY_SNAPSHOT' }))).toBe(true);
    expect(
      isBusy(
        new Error('wrapped', { cause: Object.assign(new Error('x'), { code: 'SQLITE_BUSY' }) }),
      ),
    ).toBe(true);
    expect(isBusy(Object.assign(new Error('x'), { code: 'SQLITE_ERROR' }))).toBe(false);
    expect(isBusy('SQLITE_BUSY')).toBe(false);
  });
});
