import { join } from 'node:path';
import { createClient } from '@libsql/client';

/**
 * A fixture for the browser tests: **placeholders seeded straight into the test instance's own database**, as members of a group, so that balances and
 * settling up can be shown before adding people exists (Milestone F). Only the file form, which every full run of the browser tests uses
 * (`playwright.config.ts`); the group's `seq` is moved on so that the device pulls the new members at its next sync, as it would after an operation.
 */
export async function seedPlaceholders(
  groupId: string,
  names: readonly string[],
): Promise<string[]> {
  const personIds = names.map(() => crypto.randomUUID());
  await seedMembers(
    groupId,
    names.map((name, i) => ({ name, personId: personIds[i] ?? '', create: true })),
  );
  return personIds;
}

/** Members of a group from people already seeded (the same placeholder in two groups) or new ones (`create`). */
export async function seedMembers(
  groupId: string,
  people: readonly { name: string; personId: string; create?: boolean }[],
): Promise<void> {
  const directory = process.env.TALLY_E2E_DIR;
  if (!directory || process.env.TALLY_DB_DIALECT)
    throw new Error('seeding needs the browser tests’ own SQLite file');
  const client = createClient({ url: `file:${join(directory, 'tally.db')}` });
  try {
    await client.execute('PRAGMA busy_timeout = 5000');
    const tx = await client.transaction('write');
    try {
      const moved = await tx.execute({
        sql: 'UPDATE grp SET seq = seq + 1 WHERE id = ? RETURNING seq',
        args: [groupId],
      });
      const seq = Number(moved.rows[0]?.seq);
      const now = Date.now();
      for (const [i, { name, personId, create }] of people.entries()) {
        if (create)
          await tx.execute({
            sql: 'INSERT INTO person (id, account_id, core_sub, name, email, added_by, claimed_at, deleted_at, created_at, updated_at) VALUES (?, NULL, NULL, ?, NULL, NULL, NULL, NULL, ?, ?)',
            args: [personId, name, now, now],
          });
        await tx.execute({
          sql: "INSERT INTO member (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq) VALUES (?, ?, ?, NULL, 'all', NULL, ?, NULL, ?)",
          args: [crypto.randomUUID(), groupId, personId, now + i + 1, seq],
        });
      }
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  } finally {
    client.close();
  }
}
