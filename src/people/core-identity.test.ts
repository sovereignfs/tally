import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { dbAll, dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { linkCoreIdentity, personOfAccount } from './persons';

/**
 * A core identity joined to an account (DESIGN.md §14.2), on each database: the `sub` kept on the account's person; the placeholder linked to it from
 * core's directory claimed, its memberships becoming the person's; an email never matched; safe to run twice.
 */
const { leg } = testTarget();

describe(`a core identity on the person (${leg})`, () => {
  let t: TwoAccounts;
  const db = () => tables(t.database);
  const ada = () => ({ id: t.ada.id, name: 'Ada', email: t.ada.email });

  beforeAll(async () => {
    t = await twoAccounts();
  });
  afterAll(async () => t.close());

  it('keeps the sub on the person, and claims the placeholder linked to it, whose groups become theirs', async () => {
    const groupId = crypto.randomUUID();
    const placeholder = crypto.randomUUID();
    const memberId = crypto.randomUUID();
    await dbRun(
      t.database,
      sql`INSERT INTO ${db().grp} (id, sealed, color, default_currency, simplify_debts, key_epoch, seq, pruned_through, closed_at, created_by, created_at, updated_at)
          VALUES (${groupId}, 's', '#2563eb', 'EUR', ${false}, 1, 1, 0, NULL, 'x', 1, 1)`,
    );
    await dbRun(
      t.database,
      sql`INSERT INTO ${db().person} (id, name, email, core_sub, created_at, updated_at) VALUES (${placeholder}, 'Ada from the directory', 'other@example.com', 'core-sub-ada', 1, 1)`,
    );
    await dbRun(
      t.database,
      sql`INSERT INTO ${db().member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
          VALUES (${memberId}, ${groupId}, ${placeholder}, NULL, 'all', NULL, 1, NULL, 1)`,
    );
    // Someone else's placeholder, with Ada's address and no sub: an email is never matched.
    const sameEmail = crypto.randomUUID();
    await dbRun(
      t.database,
      sql`INSERT INTO ${db().person} (id, name, email, created_at, updated_at) VALUES (${sameEmail}, 'Not Ada', ${t.ada.email}, 1, 1)`,
    );

    await linkCoreIdentity(t.database, ada(), 'core-sub-ada');
    const me = await personOfAccount(t.database, t.ada.id);
    expect(me?.coreSub).toBe('core-sub-ada');
    expect(
      await dbGet(
        t.database,
        sql`SELECT person_id AS "personId", role FROM ${db().member} WHERE id = ${memberId}`,
      ),
    ).toEqual({ personId: me?.id, role: 'member' });
    expect(
      await dbGet(t.database, sql`SELECT id FROM ${db().person} WHERE id = ${placeholder}`),
    ).toBeUndefined();
    expect(
      await dbAll(t.database, sql`SELECT kind FROM ${db().activity} WHERE group_id = ${groupId}`),
    ).toEqual([{ kind: 'member_joined' }]);
    expect(
      await dbGet(t.database, sql`SELECT id FROM ${db().person} WHERE id = ${sameEmail}`),
    ).toBeDefined();

    // Again: nothing changes.
    await linkCoreIdentity(t.database, ada(), 'core-sub-ada');
    expect((await personOfAccount(t.database, t.ada.id))?.coreSub).toBe('core-sub-ada');
    expect(
      await dbAll(t.database, sql`SELECT kind FROM ${db().activity} WHERE group_id = ${groupId}`),
    ).toHaveLength(1);
  });

  it('makes the person if the account has none yet', async () => {
    await dbRun(t.database, sql`DELETE FROM ${db().person} WHERE account_id = ${t.grace.id}`);
    await linkCoreIdentity(
      t.database,
      { id: t.grace.id, name: 'Grace', email: t.grace.email },
      'core-sub-grace',
    );
    expect(await personOfAccount(t.database, t.grace.id)).toMatchObject({
      name: 'Grace',
      coreSub: 'core-sub-grace',
    });
  });
});
