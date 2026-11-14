import { createFakeCore } from '@sovereignfs/sdk/testing';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { addExpense, expenseRow } from '../actions';
import { importGroupKey, newGroupKey, sealRow } from '../cipher/seal';
import { dbAll, dbGet, dbRun } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { opsHandler } from '../groups/api';
import { MemoryMailer } from '../mail/memory';
import { type CoreSender, sendDue } from '../mail/outbox';
import { toMinor } from '../money/amount';
import { setNoticeMailForTests } from '../notices/mail';
import { setPref } from '../notices/prefs';
import { personOfAccount } from '../people/persons';
import { applyMutation } from '../sync/apply';
import { coreSender } from './core';
import { deletePerson } from './people';

/**
 * Core's bell, email and activity (DESIGN.md §12.3, §14.5), on each database, against `@sovereignfs/sdk`'s fake core: a notice reaches core's bell
 * by the person's choice for its kind, only for someone linked to core, after the change, keyed; email goes through core for someone linked, and
 * through Tally's own mail when core will not; deleting an account notes it on the person's activity page; a core without the service, or an
 * older one, changes nothing but that.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;
const ORIGIN = 'https://tally.example';
const ALL = ['directory', 'notifications', 'email', 'activity'];

describe(`core's bell, email and activity (${leg})`, () => {
  let t: TwoAccounts;
  let ops: (request: Request) => Promise<Response>;
  let sealed = '';
  const db = () => tables(t.database);

  function coreWith(capabilities: string[] | undefined) {
    const fake = createFakeCore(
      capabilities === undefined ? { api: undefined } : { api: { versions: ['v1'], capabilities } },
    );
    fake.addPerson({ sub: 'core-grace', name: 'Grace' });
    const core = coreSender(
      ORIGIN,
      {
        issuer: fake.url,
        clientId: fake.credentials.clientId,
        clientSecret: fake.credentials.clientSecret,
      },
      fake.fetch,
    ) as CoreSender;
    return { fake, core };
  }
  const send = (core: CoreSender | undefined, mailer?: MemoryMailer) =>
    sendDue(
      {
        database: t.database,
        authDatabase: t.auth.database,
        mailer,
        core,
        app: 'Tally',
        log: () => undefined,
      },
      Date.now() + 1_000,
    );
  const outboxFor = async (accountId: string) =>
    dbAll<{ template: string; failureKind: string | null; sentAt: number | null }>(
      t.database,
      sql`SELECT template, failure_kind AS "failureKind", sent_at AS "sentAt" FROM ${db().mailOutbox} WHERE account_id = ${accountId} ORDER BY created_at, id`,
    );
  const clear = () => dbRun(t.database, sql`DELETE FROM ${db().mailOutbox}`);

  /** Ada's group with Grace; Ada pays for both. */
  async function groupWithExpense() {
    const groupId = crypto.randomUUID();
    expect(
      (
        await ops(
          t.request(t.ada, '/api/ops', {
            method: 'POST',
            body: {
              op: 'group.create',
              groupId,
              sealed,
              color: '#2563eb',
              defaultCurrency: 'EUR',
              keyWrap: WRAP,
            },
          }),
        )
      ).status,
    ).toBe(201);
    const ada =
      (
        await dbGet<{ id: string }>(
          t.database,
          sql`SELECT id FROM ${db().member} WHERE group_id = ${groupId}`,
        )
      )?.id ?? '';
    const grace = crypto.randomUUID();
    const gracePerson = (await personOfAccount(t.database, t.grace.id))?.id ?? '';
    await dbRun(
      t.database,
      sql`INSERT INTO ${db().member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
          VALUES (${grace}, ${groupId}, ${gracePerson}, 'member', 'all', NULL, ${Date.now() + 5}, NULL, 1)`,
    );
    await expense(groupId, ada, grace);
    return { groupId, ada, grace };
  }
  async function expense(groupId: string, ada: string, grace: string) {
    const row = expenseRow(
      {
        sealed,
        amount: toMinor(900),
        currency: 'EUR',
        date: '2026-11-02',
        category: 'general',
        method: 'equal',
        payers: [{ memberId: ada, amount: toMinor(900) }],
        split: [ada, grace].map((memberId) => ({ memberId, units: null })),
      },
      [ada, grace],
    );
    if (!row.ok) throw new Error(row.refusal.code);
    const adaPerson = (await personOfAccount(t.database, t.ada.id))?.id ?? '';
    expect(
      (
        await applyMutation(
          t.database,
          { accountId: t.ada.id, personId: adaPerson },
          addExpense({
            mutationId: crypto.randomUUID(),
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
      await ops(
        t.request(who, '/api/ops', {
          method: 'POST',
          body: { op: 'group.read', groupId: crypto.randomUUID() },
        }),
      );
    sealed = await sealRow({ name: 'Lisbon' }, await importGroupKey(newGroupKey()), 1, {
      group: 'g',
      table: 'grp',
      row: 'g',
    });
    // Grace's account is linked to core; Ada's is not.
    await dbRun(
      t.database,
      sql`UPDATE ${db().person} SET core_sub = 'core-grace' WHERE account_id = ${t.grace.id}`,
    );
  });
  afterEach(() => setNoticeMailForTests(null));
  afterAll(async () => t.close());

  it('sends a notice to core’s bell by the person’s choice for its kind, only for someone linked, keyed by its row', async () => {
    setNoticeMailForTests({ origin: ORIGIN, smtp: false, core: true });
    await clear();
    const { fake, core } = coreWith(ALL);
    const g = await groupWithExpense();
    // Core's bell is on for every kind by default; email for an expense is not.
    expect((await outboxFor(t.grace.id)).map((r) => r.template)).toEqual(['core_notice']);
    expect(await outboxFor(t.ada.id)).toEqual([]);
    expect(await send(core)).toEqual({ sent: 1, failed: 0 });
    expect(fake.notificationsSent).toHaveLength(1);
    expect(fake.notificationsSent[0]).toMatchObject({
      to: 'core-grace',
      title: 'Ada added an expense of €9.00 in a group on Tally',
      url: expect.stringMatching(new RegExp(`^${ORIGIN}/g/${g.groupId}/e/`)),
      category: 'info',
    });
    // Sending again sends nothing: the row is done.
    expect(await send(core)).toEqual({ sent: 0, failed: 0 });

    // Off for that kind: no row for core's bell, and the bell in Tally keeps it.
    await setPref(t.database, t.grace.id, 'expense_added', 'core_bell', false);
    await clear();
    await expense(g.groupId, g.ada, g.grace);
    expect(await outboxFor(t.grace.id)).toEqual([]);
    expect(
      await dbAll(
        t.database,
        sql`SELECT kind FROM ${db().notice} WHERE account_id = ${t.grace.id} AND group_id = ${g.groupId}`,
      ),
    ).toHaveLength(2);
    await setPref(t.database, t.grace.id, 'expense_added', 'core_bell', true);
  });

  it('emails through core for someone linked, and through Tally’s own mail where core has no mail', async () => {
    setNoticeMailForTests({ origin: ORIGIN, smtp: true, core: true });
    await setPref(t.database, t.grace.id, 'expense_added', 'email', true);
    const g = await groupWithExpense();

    await clear();
    await expense(g.groupId, g.ada, g.grace);
    const first = coreWith(ALL);
    const mailer = new MemoryMailer();
    await send(first.core, mailer);
    expect(first.fake.emailsSent).toHaveLength(1);
    expect(first.fake.emailsSent[0]).toMatchObject({
      to: 'core-grace',
      subject: 'Ada added an expense of €9.00 in a group on Tally',
    });
    expect(first.fake.emailsSent[0]?.body).not.toContain('Lisbon');
    expect(mailer.sent).toEqual([]);

    // A core whose instance has no mail server: Tally's own mail sends it instead.
    await clear();
    await expense(g.groupId, g.ada, g.grace);
    const noMail = coreWith(['directory', 'notifications', 'activity']);
    await send(noMail.core, mailer);
    expect(noMail.fake.emailsSent).toEqual([]);
    expect(mailer.sent.map((m) => m.to)).toEqual([t.grace.email]);
    await setPref(t.database, t.grace.id, 'expense_added', 'email', false);
  });

  it('a core too old for the services changes nothing but that: the bell in Tally, and Tally’s mail, as before', async () => {
    setNoticeMailForTests({ origin: ORIGIN, smtp: true, core: true });
    await setPref(t.database, t.grace.id, 'expense_added', 'email', true);
    const g = await groupWithExpense();
    await clear();
    await expense(g.groupId, g.ada, g.grace);
    const old = coreWith(undefined);
    const mailer = new MemoryMailer();
    expect(await send(old.core, mailer)).toEqual({ sent: 1, failed: 1 });
    expect(old.fake.notificationsSent).toEqual([]);
    expect(mailer.sent.map((m) => m.to)).toEqual([t.grace.email]);
    expect(
      (await outboxFor(t.grace.id)).find((r) => r.template === 'core_notice')?.failureKind,
    ).toBe('not_permitted');
    await setPref(t.database, t.grace.id, 'expense_added', 'email', false);
  });

  it('retries a send core could not take, and sends it once it can', async () => {
    setNoticeMailForTests({ origin: ORIGIN, smtp: false, core: true });
    const g = await groupWithExpense();
    await clear();
    await expense(g.groupId, g.ada, g.grace);
    const { fake, core } = coreWith(ALL);
    fake.fail({ kind: 'down' }, { target: 'api' });
    expect(await send(core)).toEqual({ sent: 0, failed: 0 });
    expect(fake.notificationsSent).toEqual([]);
    fake.heal();
    expect(
      await sendDue(
        {
          database: t.database,
          authDatabase: t.auth.database,
          core,
          app: 'Tally',
          log: () => undefined,
        },
        Date.now() + 10 * 60_000,
      ),
    ).toEqual({ sent: 1, failed: 0 });
    expect(fake.notificationsSent).toHaveLength(1);
  });

  it('notes on the person’s activity page in core that they deleted their account', async () => {
    setNoticeMailForTests({ origin: ORIGIN, smtp: false, core: true });
    await clear();
    const { fake, core } = coreWith(ALL);
    await deletePerson(
      { database: t.database, authDatabase: t.auth.database, now: Date.now },
      t.grace.id,
    );
    await send(core);
    expect(fake.activityRecorded).toHaveLength(1);
    expect(fake.activityRecorded[0]).toMatchObject({ to: 'core-grace' });
    expect(fake.activityRecorded[0]?.summary).toMatch(/^You deleted your Tally account/);
  });
});
