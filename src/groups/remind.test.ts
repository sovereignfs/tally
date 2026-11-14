import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type Person, type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { activityHandler } from '../activity/api';
import { addExpense, expenseRow } from '../actions';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { dbAll, dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { toMinor } from '../money/amount';
import { setNoticeMailForTests } from '../notices/mail';
import { personOfAccount } from '../people/persons';
import { type Actor, applyMutation } from '../sync/apply';
import { opsHandler } from './api';
import { OpError } from './errors';
import { remindMember } from './remind';
import { waitWords } from './reminder-time';

/**
 * Reminders (DESIGN.md §12.4) on each database: refused unless that member owes the reader now, by the group's setting; once a day, whatever the button
 * showed; an account told by a notice (and email), kept out of the group's Activity; a placeholder with an address sent their invitation with what they
 * owe; one without, or with no mail here, refused with a sentence that says to invite them.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;
const m = (value: number) => toMinor(value);

describe(`reminders (${leg})`, () => {
  let t: TwoAccounts;
  let ops: (request: Request) => Promise<Response>;
  let sealed = '';
  let ada: Actor;
  let grace: Actor;
  let n = 0;
  const mid = () => `mutation-${++n}-${crypto.randomUUID().slice(0, 8)}`;
  const call = (who: Person, body: Record<string, unknown>) =>
    ops(t.request(who, '/api/ops', { method: 'POST', body }));
  const db = () => tables(t.database);
  const refusal = async (reply: Response) => ({
    status: reply.status,
    ...((await reply.json()) as { code: string; message: string }),
  });

  /** Ada's group (owner) with Grace, and Sam, a placeholder with or without an address. */
  async function group(samEmail: string | null = null) {
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
      sql`INSERT INTO ${db().person} (id, name, email, created_at, updated_at) VALUES (${ids.samPerson}, 'Sam', ${samEmail}, 1, 1)`,
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

  /** `payer` pays `amount` split equally between `members`, recorded by Ada. */
  async function expense(groupId: string, members: string[], payer: string, amount: number) {
    const all = [...new Set([...members, payer])];
    const row = expenseRow(
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
      all,
    );
    if (!row.ok) throw new Error(row.refusal.code);
    expect(
      (
        await applyMutation(
          t.database,
          ada,
          addExpense({
            mutationId: mid(),
            groupId,
            expenseId: crypto.randomUUID(),
            row: row.value,
          }),
        )
      ).status,
    ).toBe('applied');
  }

  beforeAll(async () => {
    t = await twoAccounts();
    ops = accountRoute(
      opsHandler(async () => t.database),
      t.deps,
    );
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
  afterAll(async () => {
    setNoticeMailForTests(null);
    await t.close();
  });

  it('reminds someone who owes the reader, once a day; tells them, by email too, and keeps it out of the group’s Activity', async () => {
    setNoticeMailForTests({ origin: 'https://tally.example' });
    const g = await group();
    await expense(g.groupId, [g.ada, g.grace], g.ada, 3_000);
    // Grace owes Ada; Ada owes Grace nothing.
    expect(
      await refusal(
        await call(t.grace, { op: 'member.remind', groupId: g.groupId, memberId: g.ada }),
      ),
    ).toEqual({
      status: 409,
      code: 'not_owed',
      message: 'Ada does not owe you anything in this group.',
    });

    const reply = await call(t.ada, { op: 'member.remind', groupId: g.groupId, memberId: g.grace });
    expect(reply.status).toBe(200);
    expect(await reply.json()).toMatchObject({ reminded: true, by: 'notice' });
    expect(
      await dbAll(
        t.database,
        sql`SELECT kind FROM ${db().notice} WHERE account_id = ${t.grace.id} AND group_id = ${g.groupId} AND kind <> 'expense_added'`,
      ),
    ).toEqual([{ kind: 'reminder' }]);
    const mailed = await dbAll<{ data: string }>(
      t.database,
      sql`SELECT data FROM ${db().mailOutbox} WHERE account_id = ${t.grace.id} AND template = 'notice' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(JSON.parse(mailed[0]?.data ?? '{}')).toMatchObject({
      kind: 'reminder',
      actorName: 'Ada',
      amount: 1_500,
      currency: 'EUR',
    });
    // Ada, who reminded, is told nothing; Grace's Activity of the group does not show it.
    expect(
      await dbAll(
        t.database,
        sql`SELECT kind FROM ${db().notice} WHERE account_id = ${t.ada.id} AND group_id = ${g.groupId}`,
      ),
    ).toEqual([]);
    const activity = accountRoute(
      activityHandler(async () => t.database),
      t.deps,
    );
    const lines = (await (
      await activity(t.request(t.grace, `/api/activity?group=${g.groupId}`))
    ).json()) as { lines: { kind: string }[] };
    expect(lines.lines.map((l) => l.kind)).not.toContain('member_reminded');

    // Again the same day: refused by the server, whatever the button showed.
    const again = await refusal(
      await call(t.ada, { op: 'member.remind', groupId: g.groupId, memberId: g.grace }),
    );
    expect(again).toMatchObject({ status: 429, code: 'already_reminded' });
    expect(again.message).toMatch(
      /^You reminded Grace today\. You can remind them again in \d+ (hour|minute)s?\.$/,
    );
    // The next day, it goes.
    await expect(
      remindMember(
        t.database,
        ada,
        { groupId: g.groupId, memberId: g.grace },
        Date.now() + 86_400_000,
      ),
    ).resolves.toMatchObject({ reminded: true });
  });

  it('two at once are one', async () => {
    const g = await group();
    await expense(g.groupId, [g.ada, g.grace], g.ada, 1_000);
    const now = Date.now();
    const both = await Promise.allSettled([
      remindMember(t.database, ada, { groupId: g.groupId, memberId: g.grace }, now),
      remindMember(t.database, ada, { groupId: g.groupId, memberId: g.grace }, now),
    ]);
    expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      Number(
        (
          await dbGet<{ n: number }>(
            t.database,
            sql`SELECT COUNT(*) AS n FROM ${db().reminder} WHERE group_id = ${g.groupId}`,
          )
        )?.n,
      ),
    ).toBe(1);
  });

  it('derives the debt by the group’s setting: simplified, someone owes the reader who never shared a bill with them', async () => {
    setNoticeMailForTests({ origin: 'https://tally.example' });
    const g = await group('sam@example.com');
    // Sam owes Grace 10.00, and Grace owes Ada 10.00: pairwise, Sam owes Ada nothing.
    await expense(g.groupId, [g.sam], g.grace, 1_000);
    await expense(g.groupId, [g.grace], g.ada, 1_000);
    expect(
      await refusal(
        await call(t.ada, { op: 'member.remind', groupId: g.groupId, memberId: g.sam }),
      ),
    ).toMatchObject({ status: 409, code: 'not_owed' });
    expect((await call(t.ada, { op: 'group.simplify', groupId: g.groupId, on: true })).status).toBe(
      200,
    );
    // Simplified, Sam owes Ada: Sam, not on Tally, is sent their invitation with what they owe.
    const reply = await call(t.ada, { op: 'member.remind', groupId: g.groupId, memberId: g.sam });
    expect(await reply.json()).toMatchObject({ reminded: true, by: 'email' });
    const mail = await dbGet<{ data: string }>(
      t.database,
      sql`SELECT data FROM ${db().mailOutbox} WHERE to_address = 'sam@example.com' AND template = 'invitation' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(JSON.parse(mail?.data ?? '{}')).toMatchObject({
      inviterName: 'Ada',
      reminder: '€10.00',
      link: expect.stringMatching(/^https:\/\/tally\.example\/invite\/[A-Za-z0-9_-]{43}$/),
    });
    expect(
      await dbGet(
        t.database,
        sql`SELECT COUNT(*) AS n FROM ${db().invitation} WHERE person_id = ${g.samPerson} AND accepted_at IS NULL AND revoked_at IS NULL`,
      ),
    ).toMatchObject({ n: 1 });
  });

  it('a placeholder with no address, or no mail here, cannot be reminded; a stranger’s group is not found', async () => {
    setNoticeMailForTests({ origin: 'https://tally.example' });
    const g = await group(null);
    await expense(g.groupId, [g.sam], g.ada, 1_000);
    expect(
      await refusal(
        await call(t.ada, { op: 'member.remind', groupId: g.groupId, memberId: g.sam }),
      ),
    ).toEqual({
      status: 409,
      code: 'cannot_remind',
      message: 'Sam is not on Tally yet and has no email address here. Invite Sam to remind them.',
    });
    const withAddress = await group('sam2@example.com');
    await expense(withAddress.groupId, [withAddress.sam], withAddress.ada, 1_000);
    setNoticeMailForTests(undefined);
    expect(
      await refusal(
        await call(t.ada, {
          op: 'member.remind',
          groupId: withAddress.groupId,
          memberId: withAddress.sam,
        }),
      ),
    ).toMatchObject({ status: 409, code: 'cannot_remind' });
    // Nothing kept for a refused one.
    expect(
      await dbGet(
        t.database,
        sql`SELECT COUNT(*) AS n FROM ${db().reminder} WHERE group_id = ${withAddress.groupId}`,
      ),
    ).toMatchObject({ n: 0 });
    // Grace out of a group reads it as not found; so does reminding oneself.
    await dbRun(t.database, sql`UPDATE ${db().member} SET left_at = 1 WHERE id = ${g.grace}`);
    expect(
      (await call(t.grace, { op: 'member.remind', groupId: g.groupId, memberId: g.sam })).status,
    ).toBe(404);
    await expect(
      remindMember(t.database, ada, { groupId: g.groupId, memberId: g.ada }),
    ).rejects.toBeInstanceOf(OpError);
  });

  it('says the wait until tomorrow', () => {
    expect(waitWords(Date.parse('2026-11-14T19:30:00Z'))).toBe('in 5 hours');
    expect(waitWords(Date.parse('2026-11-14T23:20:00Z'))).toBe('in 40 minutes');
    expect(waitWords(Date.parse('2026-11-14T23:59:30Z'))).toBe('in 1 minute');
  });
});
