import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { makeStore } from '../db/test-store';
import { testTarget } from '../db/test-support';
import { ensurePerson } from '../people/persons';
import { personRecords, toRecords } from './core-export';

/**
 * A person's part of core's export (`signIn.export`): their profile and every group they are in, whole, with what people wrote still sealed; nothing of a
 * group they are not in, and nothing the server keeps for its own work.
 */
const { leg } = testTarget();

describe('rows as records', () => {
  it('write a time as ISO 8601 in UTC, leave out the sync’s counters, and keep sealed text as stored', () => {
    expect(
      toRecords([
        { id: 'e1', sealed: 's1.1.x', created_at: Date.UTC(2026, 0, 1), seq: 4, key_epoch: 2 },
      ]),
    ).toEqual([{ id: 'e1', sealed: 's1.1.x', created_at: '2026-01-01T00:00:00.000Z' }]);
    expect(toRecords([{ deleted_at: null, left_at: '1767225600000' }])).toEqual([
      { deleted_at: null, left_at: '2026-01-01T00:00:00.000Z' },
    ]);
  });
});

describe(`a person’s part (${leg})`, () => {
  let database: Database;
  let close: () => Promise<void>;
  const ada = crypto.randomUUID();
  const grace = crypto.randomUUID();
  const shared = crypto.randomUUID();
  const hers = crypto.randomUUID();
  let adaPerson = '';
  let gracePerson = '';

  async function group(id: string, by: string) {
    await dbRun(
      database,
      sql`INSERT INTO ${tables(database).grp} (id, sealed, color, default_currency, simplify_debts, closed_at, key_epoch, seq, created_by, created_at, updated_at)
          VALUES (${id}, 's1.1.name', '#2563eb', 'EUR', ${false}, NULL, 1, 1, ${by}, 1, 1)`,
    );
  }
  async function member(groupId: string, personId: string) {
    await dbRun(
      database,
      sql`INSERT INTO ${tables(database).member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
          VALUES (${crypto.randomUUID()}, ${groupId}, ${personId}, 'member', 'all', NULL, 1, NULL, 1)`,
    );
  }
  async function expense(groupId: string, by: string, sealed: string) {
    await dbRun(
      database,
      sql`INSERT INTO ${tables(database).expense} (id, group_id, amount, currency, date, category, sealed, method, version, created_by, updated_by, deleted_at, seq, created_at, updated_at)
          VALUES (${crypto.randomUUID()}, ${groupId}, 100, 'EUR', '2026-11-01', 'general', ${sealed}, 'equal', 1, ${by}, ${by}, NULL, 1, 1, 1)`,
    );
  }

  beforeAll(async () => {
    ({ database, close } = await makeStore());
    adaPerson = (await ensurePerson(database, { id: ada, name: 'Ada', email: 'ada@example.com' }))
      .id;
    gracePerson = (
      await ensurePerson(database, { id: grace, name: 'Grace', email: 'grace@example.com' })
    ).id;
    await group(shared, adaPerson);
    await member(shared, adaPerson);
    await member(shared, gracePerson);
    await expense(shared, adaPerson, 's1.1.dinner');
    await group(hers, gracePerson);
    await member(hers, gracePerson);
    await expense(hers, gracePerson, 's1.1.hers-alone');
  });
  afterAll(async () => close());

  it('holds the person and every group they are in, with its members by name only', async () => {
    const parts = await personRecords(database, ada);
    const kind = (k: string) => parts.find((p) => p.kind === k)?.records ?? [];
    expect(kind('person')).toEqual([
      expect.objectContaining({ name: 'Ada', email: 'ada@example.com' }),
    ]);
    expect(kind('grp').map((g) => g.id)).toEqual([shared]);
    expect(
      kind('member')
        .map((m) => m.name)
        .sort(),
    ).toEqual(['Ada', 'Grace']);
    expect(JSON.stringify(kind('member'))).not.toContain('grace@example.com');
  });

  it('carries what people wrote as stored, marked end to end, and nothing of a group they are not in', async () => {
    const parts = await personRecords(database, ada);
    const expenses = parts.find((p) => p.kind === 'expense');
    expect(expenses?.endToEnd).toBe(true);
    expect(expenses?.records.map((e) => e.sealed)).toEqual(['s1.1.dinner']);
    expect(JSON.stringify(parts)).not.toContain('hers-alone');
    expect(parts.find((p) => p.kind === 'member')?.endToEnd).toBe(false);
  });

  it('is empty for an account Tally has no person for', async () => {
    expect(await personRecords(database, crypto.randomUUID())).toEqual([]);
  });
});
