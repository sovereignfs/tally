import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EXPORTED_TABLES,
  FORMAT,
  type GroupInput,
  LEFT_OUT_TABLES,
  VERSION,
  buildExport,
} from './format';

/**
 * The export file (DESIGN.md §17): every table of a group in it, text opened, deleted rows out, no email but the person's own, deterministic; and every
 * table of the store either exported or named as left out, so that a new one cannot slip past.
 */
const text: Record<string, Record<string, string | null>> = {
  's-lisbon': { name: 'Lisbon' },
  's-dinner': { description: 'Dinner at Ramiro', note: 'the seafood one' },
  's-tram': { description: 'Tram', note: null },
  's-paid': { note: 'cash' },
  's-comment': { body: 'Worth it' },
};
const opened = (sealed: string) => text[sealed];

const lisbon: GroupInput = {
  group: {
    id: 'g-lisbon',
    sealed: 's-lisbon',
    color: '#2563eb',
    defaultCurrency: 'EUR',
    simplifyDebts: false,
    closedAt: null,
  },
  members: [
    {
      id: 'm-sam',
      personId: 'p-sam',
      name: 'Sam',
      role: null,
      placeholder: true,
      leftTally: false,
      joinedAt: 2,
      leftAt: null,
    },
    {
      id: 'm-ada',
      personId: 'p-ada',
      name: 'Ada',
      role: 'owner',
      placeholder: false,
      leftTally: false,
      joinedAt: 1,
      leftAt: null,
    },
  ],
  expenses: [
    {
      id: 'e-tram',
      sealed: 's-tram',
      amount: 960,
      currency: 'EUR',
      date: '2026-11-03',
      category: 'transport',
      method: 'equal',
      payers: [{ memberId: 'm-ada', amount: 960 }],
      shares: [
        { memberId: 'm-ada', amount: 480, units: null },
        { memberId: 'm-sam', amount: 480, units: null },
      ],
      deletedAt: null,
      createdAt: 20,
    },
    {
      id: 'e-dinner',
      sealed: 's-dinner',
      amount: 6000,
      currency: 'EUR',
      date: '2026-11-02',
      category: 'eating_out',
      method: 'equal',
      payers: [{ memberId: 'm-sam', amount: 6000 }],
      shares: [
        { memberId: 'm-ada', amount: 3000, units: null },
        { memberId: 'm-sam', amount: 3000, units: null },
      ],
      deletedAt: null,
      createdAt: 10,
    },
    {
      id: 'e-gone',
      sealed: 's-tram',
      amount: 100,
      currency: 'EUR',
      date: '2026-11-01',
      category: 'general',
      method: 'equal',
      payers: [{ memberId: 'm-ada', amount: 100 }],
      shares: [{ memberId: 'm-ada', amount: 100, units: null }],
      deletedAt: 30,
      createdAt: 5,
    },
  ],
  payments: [
    {
      id: 'p-1',
      sealed: 's-paid',
      fromMemberId: 'm-ada',
      toMemberId: 'm-sam',
      amount: 2520,
      currency: 'EUR',
      date: '2026-11-04',
      deletedAt: null,
      createdAt: 40,
    },
  ],
  comments: [
    {
      id: 'c-1',
      subject: 'expense',
      subjectId: 'e-dinner',
      authorPersonId: 'p-ada',
      sealed: 's-comment',
      deletedAt: null,
      createdAt: 15,
    },
    {
      id: 'c-gone',
      subject: 'expense',
      subjectId: 'e-dinner',
      authorPersonId: 'p-ada',
      sealed: 's-comment',
      deletedAt: 16,
      createdAt: 16,
    },
  ],
};
const locked: GroupInput = {
  group: {
    id: 'g-flat',
    sealed: 's-not-unlocked',
    color: '#16a34a',
    defaultCurrency: 'JPY',
    simplifyDebts: true,
    closedAt: 99,
  },
  members: [
    {
      id: 'f-ada',
      personId: 'p-ada',
      name: 'Ada',
      role: 'member',
      placeholder: false,
      leftTally: false,
      joinedAt: 1,
      leftAt: null,
    },
  ],
  expenses: [],
  payments: [],
  comments: [],
};
const profile = {
  name: 'Ada',
  email: 'ada@example.com',
  primaryCurrency: 'EUR',
  notifications: { reminder: { email: true } },
};
const build = (now = Date.UTC(2026, 10, 14)) =>
  buildExport({ profile, personId: 'p-ada', groups: [locked, lisbon], opened, now });

describe('the export file', () => {
  it('holds the profile, and every group whole: members by name, expenses with payers, shares and comments, payments; text opened', () => {
    const file = build();
    expect(file).toMatchObject({
      format: FORMAT,
      version: VERSION,
      exportedAt: '2026-11-14T00:00:00.000Z',
      profile,
    });
    expect(file.groups.map((g) => g.id)).toEqual(['g-flat', 'g-lisbon']);
    const g = file.groups[1];
    expect(g).toMatchObject({ name: 'Lisbon', yourMemberId: 'm-ada', defaultCurrency: 'EUR' });
    expect(g?.members.map((m) => [m.id, m.name, m.placeholder])).toEqual([
      ['m-ada', 'Ada', false],
      ['m-sam', 'Sam', true],
    ]);
    // In order of date; the deleted one is not there.
    expect(g?.expenses.map((e) => e.id)).toEqual(['e-dinner', 'e-tram']);
    expect(g?.expenses[0]).toMatchObject({
      description: 'Dinner at Ramiro',
      note: 'the seafood one',
      amount: 6000,
      payers: [{ memberId: 'm-sam', amount: 6000 }],
      comments: [{ id: 'c-1', authorMemberId: 'm-ada', body: 'Worth it', createdAt: 15 }],
    });
    expect(g?.expenses[0]?.shares).toHaveLength(2);
    expect(g?.payments).toEqual([
      expect.objectContaining({
        id: 'p-1',
        note: 'cash',
        fromMemberId: 'm-ada',
        toMemberId: 'm-sam',
        amount: 2520,
      }),
    ]);
  });

  it('says how much it could not open, and leaves that text out rather than guessing', () => {
    const file = build();
    expect(file.groups[0]?.name).toBeNull();
    expect(file.unopened).toBe(1);
  });

  it('has no email but the person’s own, and is the same twice but for when it was made', () => {
    const file = JSON.stringify(build());
    expect(file.match(/[^\s"]+@[^\s"]+/g)).toEqual(['ada@example.com']);
    const again = JSON.stringify(build(Date.UTC(2027, 0, 1)));
    expect(again.replace(/"exportedAt":"[^"]+"/, '')).toBe(
      file.replace(/"exportedAt":"[^"]+"/, ''),
    );
  });

  it('decides every table of the store: exported, or named as left out with why', () => {
    const schema = readFileSync(new URL('../db/schema/sqlite/app.ts', import.meta.url), 'utf8');
    const tables = [...schema.matchAll(/sqliteTable\(\s*'([a-z_]+)'/g)].map((m) => m[1]).sort();
    const decided = [...Object.keys(EXPORTED_TABLES), ...Object.keys(LEFT_OUT_TABLES)].sort();
    expect(tables.length).toBeGreaterThan(10);
    expect(decided).toEqual(tables);
  });
});
