import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountRoute } from '../access/route';
import { type TwoAccounts, twoAccounts } from '../access/two-accounts';
import { importGroupKey, newGroupKey, openRow } from '../cipher/seal';
import { dbAll, dbGet } from '../db/exec';
import { tables } from '../db/tables';
import { testTarget } from '../db/test-support';
import { opsHandler } from '../groups/api';
import { personOfAccount } from '../people/persons';
import { type ExportFile, type GroupInput, buildExport } from './format';
import { IMPORT_RATE, MAX_ROWS_IN_IMPORT, importGroups } from './import';
import { prepareImport } from './prepare';
import { validateFile } from './validate';

/**
 * Import (DESIGN.md §17), on each database: **the round trip** (export, import into a second account, export again: the groups match but for ids,
 * times and the members' kind); the importer the owner and everyone else a placeholder with a name and no email; a file from a newer version refused
 * with a sentence; and a file wrong anywhere writes nothing.
 */
const { leg } = testTarget();
const WRAP = `h1.${'K'.repeat(60)}`;

/** A file as Ada's export makes it: two groups, two currencies, a comment, a member who left. */
function original(): ExportFile {
  const text: Record<string, Record<string, string | null>> = {
    n1: { name: 'Lisbon' },
    n2: { name: 'Flat' },
    e1: { description: 'Dinner at Ramiro', note: 'the seafood one' },
    e2: { description: 'Tram', note: null },
    e3: { description: 'Rent', note: null },
    p1: { note: 'cash' },
    c1: { body: 'Worth it' },
  };
  const lisbon: GroupInput = {
    group: {
      id: 'g1',
      sealed: 'n1',
      color: '#2563eb',
      defaultCurrency: 'EUR',
      simplifyDebts: false,
      closedAt: null,
    },
    members: [
      {
        id: 'a',
        personId: 'p-ada',
        name: 'Ada',
        role: 'owner',
        placeholder: false,
        leftTally: false,
        joinedAt: 1,
        leftAt: null,
      },
      {
        id: 's',
        personId: 'p-sam',
        name: 'Sam',
        role: null,
        placeholder: true,
        leftTally: false,
        joinedAt: 2,
        leftAt: null,
      },
      {
        id: 'l',
        personId: 'p-lee',
        name: 'Lee',
        role: 'member',
        placeholder: false,
        leftTally: false,
        joinedAt: 3,
        leftAt: 9,
      },
    ],
    expenses: [
      {
        id: 'x1',
        sealed: 'e1',
        amount: 10_001,
        currency: 'EUR',
        date: '2026-11-02',
        category: 'eating_out',
        method: 'equal',
        payers: [{ memberId: 's', amount: 10_001 }],
        shares: [
          { memberId: 'a', amount: 3_334, units: null },
          { memberId: 's', amount: 3_334, units: null },
          { memberId: 'l', amount: 3_333, units: null },
        ],
        deletedAt: null,
        createdAt: 10,
      },
      {
        id: 'x2',
        sealed: 'e2',
        amount: 1_500,
        currency: 'JPY',
        date: '2026-11-03',
        category: 'transport',
        method: 'shares',
        payers: [{ memberId: 'a', amount: 1_500 }],
        shares: [
          { memberId: 'a', amount: 1_000, units: 2 },
          { memberId: 's', amount: 500, units: 1 },
        ],
        deletedAt: null,
        createdAt: 11,
      },
    ],
    payments: [
      {
        id: 'y1',
        sealed: 'p1',
        fromMemberId: 'a',
        toMemberId: 's',
        amount: 2_000,
        currency: 'EUR',
        date: '2026-11-04',
        deletedAt: null,
        createdAt: 12,
      },
    ],
    comments: [
      {
        id: 'k1',
        subject: 'expense',
        subjectId: 'x1',
        authorPersonId: 'p-sam',
        sealed: 'c1',
        deletedAt: null,
        createdAt: 13,
      },
    ],
  };
  const flat: GroupInput = {
    group: {
      id: 'g2',
      sealed: 'n2',
      color: '#16a34a',
      defaultCurrency: 'EUR',
      simplifyDebts: true,
      closedAt: null,
    },
    members: [
      {
        id: 'b',
        personId: 'p-ada',
        name: 'Ada',
        role: 'member',
        placeholder: false,
        leftTally: false,
        joinedAt: 1,
        leftAt: null,
      },
      {
        id: 'e',
        personId: 'p-eve',
        name: 'Eve',
        role: 'owner',
        placeholder: false,
        leftTally: false,
        joinedAt: 0,
        leftAt: null,
      },
    ],
    expenses: [
      {
        id: 'x3',
        sealed: 'e3',
        amount: 120_000,
        currency: 'EUR',
        date: '2026-11-01',
        category: 'rent',
        method: 'amounts',
        payers: [{ memberId: 'e', amount: 120_000 }],
        shares: [
          { memberId: 'b', amount: 70_000, units: 70_000 },
          { memberId: 'e', amount: 50_000, units: 50_000 },
        ],
        deletedAt: null,
        createdAt: 5,
      },
    ],
    payments: [],
    comments: [],
  };
  return buildExport({
    profile: { name: 'Ada', email: 'ada@example.com', primaryCurrency: 'EUR', notifications: {} },
    personId: 'p-ada',
    groups: [lisbon, flat],
    opened: (s) => text[s],
    now: 1,
  });
}

/** A file with ids, times and the members' kind taken out, and the importer's own member's name: what a round trip must keep. */
function kept(file: ExportFile) {
  return file.groups
    .map((g) => {
      const token = new Map<string, string>();
      const t = (id: string | null) => {
        if (id === null) return null;
        if (!token.has(id)) token.set(id, `#${token.size}`);
        return token.get(id) ?? null;
      };
      return {
        name: g.name,
        color: g.color,
        defaultCurrency: g.defaultCurrency,
        simplifyDebts: g.simplifyDebts,
        you: t(g.yourMemberId),
        members: g.members.map((m) => ({
          id: t(m.id),
          name: m.id === g.yourMemberId ? 'you' : m.name,
          left: m.leftAt !== null,
        })),
        expenses: g.expenses.map((e) => ({
          date: e.date,
          category: e.category,
          amount: e.amount,
          currency: e.currency,
          method: e.method,
          description: e.description,
          note: e.note,
          payers: e.payers.map((p) => ({ ...p, memberId: t(p.memberId) })),
          shares: e.shares.map((s) => ({ ...s, memberId: t(s.memberId) })),
          comments: e.comments.map((c) => ({ author: t(c.authorMemberId), body: c.body })),
        })),
        payments: g.payments.map((p) => ({
          date: p.date,
          amount: p.amount,
          currency: p.currency,
          note: p.note,
          from: t(p.fromMemberId),
          to: t(p.toMemberId),
          comments: p.comments.map((c) => ({ author: t(c.authorMemberId), body: c.body })),
        })),
      };
    })
    .sort((a, b) => ((a.name ?? '') < (b.name ?? '') ? -1 : 1));
}

describe(`import (${leg})`, () => {
  let t: TwoAccounts;
  let grace: { accountId: string; personId: string };
  const keys = new Map<string, CryptoKey>();
  const keyer = {
    async keyForImport(groupId: string) {
      const key = await importGroupKey(newGroupKey());
      keys.set(groupId, key);
      return { key, keyWrap: WRAP };
    },
  };
  const db = () => tables(t.database);

  /** Grace's groups read back from the database as a device would hold them, and exported again. */
  async function exportAgain(groupIds: string[]): Promise<ExportFile> {
    const inputs: GroupInput[] = [];
    const opened = new Map<string, Record<string, string | null>>();
    for (const groupId of groupIds) {
      const key = keys.get(groupId);
      if (!key) throw new Error('no key');
      const open = async (
        sealed: string | null,
        table: 'grp' | 'expense' | 'payment' | 'comment',
        row: string,
      ) => {
        if (sealed)
          opened.set(
            sealed,
            (await openRow(sealed, key, { group: groupId, table, row })) as Record<
              string,
              string | null
            >,
          );
      };
      const group = await dbGet<{
        sealed: string;
        color: string;
        defaultCurrency: string;
        simplifyDebts: number | boolean;
        closedAt: number | null;
      }>(
        t.database,
        sql`SELECT sealed, color, default_currency AS "defaultCurrency", simplify_debts AS "simplifyDebts", closed_at AS "closedAt" FROM ${db().grp} WHERE id = ${groupId}`,
      );
      if (!group) throw new Error('no group');
      await open(group.sealed, 'grp', groupId);
      const members = await dbAll<{
        id: string;
        personId: string;
        name: string;
        role: string | null;
        accountId: string | null;
        joinedAt: number;
        leftAt: number | null;
      }>(
        t.database,
        sql`SELECT m.id, m.person_id AS "personId", p.name, m.role, p.account_id AS "accountId", m.joined_at AS "joinedAt", m.left_at AS "leftAt"
            FROM ${db().member} m JOIN ${db().person} p ON p.id = m.person_id WHERE m.group_id = ${groupId}`,
      );
      const expenses = await dbAll<{
        id: string;
        sealed: string;
        amount: number;
        currency: string;
        date: string;
        category: string;
        method: string;
        createdAt: number;
      }>(
        t.database,
        sql`SELECT id, sealed, amount, currency, date, category, method, created_at AS "createdAt" FROM ${db().expense} WHERE group_id = ${groupId}`,
      );
      const payers = await dbAll<{ expenseId: string; memberId: string; amount: number }>(
        t.database,
        sql`SELECT expense_id AS "expenseId", member_id AS "memberId", amount FROM ${db().expensePayer} WHERE group_id = ${groupId}`,
      );
      const shares = await dbAll<{
        expenseId: string;
        memberId: string;
        amount: number;
        units: number | null;
      }>(
        t.database,
        sql`SELECT expense_id AS "expenseId", member_id AS "memberId", amount, units FROM ${db().expenseShare} WHERE group_id = ${groupId}`,
      );
      const payments = await dbAll<{
        id: string;
        sealed: string | null;
        fromMemberId: string;
        toMemberId: string;
        amount: number;
        currency: string;
        date: string;
        createdAt: number;
      }>(
        t.database,
        sql`SELECT id, sealed, from_member_id AS "fromMemberId", to_member_id AS "toMemberId", amount, currency, date, created_at AS "createdAt" FROM ${db().payment} WHERE group_id = ${groupId}`,
      );
      const comments = await dbAll<{
        id: string;
        subject: 'expense' | 'payment';
        subjectId: string;
        authorPersonId: string;
        sealed: string;
        createdAt: number;
      }>(
        t.database,
        sql`SELECT id, subject, subject_id AS "subjectId", author_person_id AS "authorPersonId", sealed, created_at AS "createdAt" FROM ${db().comment} WHERE group_id = ${groupId}`,
      );
      for (const e of expenses) await open(e.sealed, 'expense', e.id);
      for (const p of payments) await open(p.sealed, 'payment', p.id);
      for (const c of comments) await open(c.sealed, 'comment', c.id);
      // The order rows were written in stands in for the order they were made in, which an import makes at one moment.
      inputs.push({
        group: {
          id: groupId,
          ...group,
          simplifyDebts: group.simplifyDebts === true || Number(group.simplifyDebts) === 1,
        },
        members: members.map((m) => ({
          id: m.id,
          personId: m.personId,
          name: m.name,
          role: m.role as 'owner' | null,
          placeholder: m.accountId === null,
          leftTally: false,
          joinedAt: Number(m.joinedAt),
          leftAt: m.leftAt === null ? null : Number(m.leftAt),
        })),
        expenses: expenses.map((e) => ({
          ...e,
          amount: Number(e.amount),
          deletedAt: null,
          createdAt: Number(e.createdAt),
          payers: payers
            .filter((p) => p.expenseId === e.id)
            .map((p) => ({ memberId: p.memberId, amount: Number(p.amount) })),
          shares: shares
            .filter((s) => s.expenseId === e.id)
            .map((s) => ({
              memberId: s.memberId,
              amount: Number(s.amount),
              units: s.units === null ? null : Number(s.units),
            })),
        })),
        payments: payments.map((p) => ({
          ...p,
          amount: Number(p.amount),
          deletedAt: null,
          createdAt: Number(p.createdAt),
        })),
        comments: comments.map((c) => ({ ...c, deletedAt: null, createdAt: Number(c.createdAt) })),
      });
    }
    return buildExport({
      profile: { name: 'Grace', email: t.grace.email, primaryCurrency: 'EUR', notifications: {} },
      personId: grace.personId,
      groups: inputs,
      opened: (s) => opened.get(s),
      now: 2,
    });
  }

  beforeAll(async () => {
    t = await twoAccounts();
    const ops = accountRoute(
      opsHandler(async () => t.database),
      t.deps,
    );
    await ops(
      t.request(t.grace, '/api/ops', {
        method: 'POST',
        body: { op: 'group.read', groupId: crypto.randomUUID() },
      }),
    );
    grace = {
      accountId: t.grace.id,
      personId: (await personOfAccount(t.database, t.grace.id))?.id ?? '',
    };
  });
  afterAll(async () => t.close());

  it('round-trips: export, import into a second account, export again, and the groups match but for ids, times and the members’ kind', async () => {
    const file = original();
    const checked = validateFile(JSON.parse(JSON.stringify(file)));
    if (!checked.ok) throw new Error(checked.message);
    const request = await prepareImport(checked.file, keyer, 'Grace');
    const made = await importGroups(t.database, grace, JSON.parse(JSON.stringify(request)));
    expect(made.groups).toHaveLength(2);
    const again = await exportAgain(made.groups);
    expect(kept(again)).toEqual(kept(file));

    // Grace owns each; everyone else is a placeholder with a name and no email.
    const members = await dbAll<{
      role: string | null;
      accountId: string | null;
      email: string | null;
      name: string;
    }>(
      t.database,
      sql`SELECT m.role, p.account_id AS "accountId", p.email, p.name FROM ${db().member} m JOIN ${db().person} p ON p.id = m.person_id
          WHERE m.group_id IN (${sql.join(
            made.groups.map((g) => sql`${g}`),
            sql`, `,
          )})`,
    );
    expect(members.filter((m) => m.accountId === t.grace.id).map((m) => m.role)).toEqual([
      'owner',
      'owner',
    ]);
    expect(
      members
        .filter((m) => m.accountId !== t.grace.id)
        .every((m) => m.accountId === null && m.email === null && m.role === null),
    ).toBe(true);
  });

  it('refuses a file from a newer version, with a sentence that says so', () => {
    const newer = { ...original(), version: 2 };
    expect(validateFile(newer)).toEqual({
      ok: false,
      message:
        'This file was made by a newer Tally (its version is 2, and this one reads 1). Update this Tally to import it.',
    });
    expect(validateFile({ format: 'tusk', version: 1 })).toMatchObject({ ok: false });
    // Shares that do not add up: refused whole.
    const broken = original();
    const share = broken.groups[0]?.expenses[0]?.shares[0];
    if (share) share.amount += 1;
    expect(validateFile(broken)).toMatchObject({ ok: false });
  });

  it('writes nothing when anything is wrong, even in the last group', async () => {
    const count = async () =>
      Number(
        (await dbGet<{ n: number }>(t.database, sql`SELECT COUNT(*) AS n FROM ${db().grp}`))?.n,
      );
    const before = await count();
    const checked = validateFile(original());
    if (!checked.ok) throw new Error(checked.message);
    const request = await prepareImport(checked.file, keyer, 'Grace');
    const last = request.groups[request.groups.length - 1];
    if (last?.expenses[0]) last.expenses[0].amount += 1;
    await expect(importGroups(t.database, grace, request)).rejects.toThrow();
    // A sealed text bound to another row is refused too: it would not open.
    const again = await prepareImport(checked.file, keyer, 'Grace');
    const first = again.groups[0];
    if (first) first.sealed = 'not sealed';
    await expect(importGroups(t.database, grace, again)).rejects.toThrow();
    expect(await count()).toBe(before);
  });

  it('refuses a file larger than any real history, and more than a few imports an hour', async () => {
    const huge = { groups: [{ expenses: new Array(MAX_ROWS_IN_IMPORT + 1).fill({}) }] };
    await expect(importGroups(t.database, grace, huge)).rejects.toThrow();
    const checked = validateFile(original());
    if (!checked.ok) throw new Error(checked.message);
    // The earlier imports here counted too; the limit is reached within ten.
    let refused = false;
    for (let i = 0; i < IMPORT_RATE.limit && !refused; i++) {
      try {
        await importGroups(t.database, grace, await prepareImport(checked.file, keyer, 'Grace'));
      } catch (error) {
        expect((error as { code?: string }).code).toBe('rate_limited');
        refused = true;
      }
    }
    expect(refused).toBe(true);
  });
});
