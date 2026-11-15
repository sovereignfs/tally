import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  addComment,
  addExpense,
  addPayment,
  editExpense,
  expenseRow,
  type ExpenseIntent,
} from '../src/actions';
import type { Mutation } from '../src/actions/types';
import { createAuth } from '../src/auth/auth';
import { toBase64Url } from '../src/cipher/bytes';
import { exportX25519Private, generateX25519 } from '../src/cipher/hpke';
import { PASSWORD_V1, derivePassword } from '../src/cipher/password';
import { importGroupKey, newGroupKey, sealRow } from '../src/cipher/seal';
import { wrapToPublicKey, wrapToSecret } from '../src/cipher/wrap';
import { loadConfig } from '../src/config';
import { processEnv } from '../src/config/env';
import type { Database } from '../src/db/client';
import type { DatabaseConfig } from '../src/db/config';
import { getStores } from '../src/db/boot';
import { dbAll, dbGet } from '../src/db/exec';
import * as postgresAuth from '../src/db/schema/postgres/auth';
import * as sqliteAuth from '../src/db/schema/sqlite/auth';
import { tables } from '../src/db/tables';
import { closeGroup } from '../src/groups/lifecycle';
import { createGroup, setSimplifyDebts } from '../src/groups/ops';
import { addPerson } from '../src/groups/people';
import { createInvitation } from '../src/invites/store';
import { createAccountKey } from '../src/keys/store';
import { toMinor } from '../src/money/amount';
import { memberOrder } from '../src/money/split';
import { ensurePerson } from '../src/people/persons';
import { deletePerson } from '../src/sovereign/people';
import { applyMutation } from '../src/sync/apply';

/**
 * **A realistic set of groups to develop against** (DESIGN.md §20, task 13.1): `pnpm seed`, or `pnpm seed -- --reset` to start it again. Like Tusk's
 * `scripts/seed.ts`, it goes **through the app's own paths**: the accounts through better-auth, the groups and people through the operations
 * (`src/groups/`), every expense, payment and comment through `applyMutation`, the one write path, with the checks the app makes. Each account's
 * key is made as the browser makes it, wrapped by the password, and each group's key is wrapped to every member, so a seeded person signs in with
 * the password below and reads everything at once.
 *
 * - **Idempotent.** Every id and every mutation id is fixed (`id`), and a group already there is left as it is: a second run changes nothing.
 * - **Local only.** It refuses an address or a database that is not on this machine, since its password is written in this file.
 * - `--reset` deletes the seeded accounts (`deletePerson`, which takes their groups and placeholders with them) and makes everything again.
 *
 * What is in it: three accounts (Ada, Grace, Lee); **Lisbon trip**, in euros and yen, with every split method, an expense with two payers, a
 * conflict in its history (an edit replaced by another), comments, payments, simplify debts off, and Sam, not on Tally yet, with a live
 * invitation; **Flat**, with simplify debts on; and **Ski weekend**, settled and closed.
 */
export const SEED_PASSWORD = 'tally-development-only';
export const PEOPLE = [
  { key: 'ada', name: 'Ada', email: 'ada@example.test' },
  { key: 'grace', name: 'Grace', email: 'grace@example.test' },
  { key: 'lee', name: 'Lee', email: 'lee@example.test' },
] as const;
type Key = (typeof PEOPLE)[number]['key'];

/** A UUID (version 5 form) from a name: the same name, the same id, every run. */
export function id(name: string): string {
  const hash = createHash('sha1').update(`tally-seed:${name}`).digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const GROUPS = {
  lisbon: id('group:lisbon'),
  flat: id('group:flat'),
  ski: id('group:ski'),
} as const;

/** Whether an address and a database are on this machine. */
export function isLocal(url: string | undefined, database: DatabaseConfig): boolean {
  const local = (host: string) =>
    ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host) || host.endsWith('.localhost');
  if (!url || !local(new URL(url).hostname)) return false;
  if (database.dialect === 'postgres') return local(new URL(database.url).hostname);
  if (database.form === 'file') return true;
  return local(new URL(database.url).hostname) && local(new URL(database.adminUrl).hostname);
}

interface Person {
  accountId: string;
  personId: string;
  publicKey: Uint8Array;
}

export interface SeedStores {
  app: Database;
  auth: Database;
}

const authTables = (database: Database) =>
  database.dialect === 'postgres' ? postgresAuth : sqliteAuth;

/** The accounts, made through better-auth with the password as the browser sends it, and each one's key as the browser makes it. */
async function accounts(stores: SeedStores, url: string, secret: string, now: number) {
  const auth = createAuth({
    settings: {
      url,
      secret,
      signUp: 'open',
      passwordMinLength: 10,
      local: true,
      sovereign: undefined,
    },
    name: 'Tally',
    database: stores.auth,
    onAccountCreated: async (account) => {
      await ensurePerson(stores.app, account, now);
    },
  });
  const people = {} as Record<Key, Person>;
  for (const who of PEOPLE) {
    const values = await derivePassword(SEED_PASSWORD, url, who.email);
    let user = await dbGet<{ id: string }>(
      stores.auth,
      sql`SELECT id FROM ${authTables(stores.auth).user} WHERE email = ${who.email}`,
    );
    if (!user) {
      const made = await auth.api.signUpEmail({
        body: { name: who.name, email: who.email, password: values.signIn },
      });
      user = { id: made.user.id };
    }
    const person = await ensurePerson(
      stores.app,
      { id: user.id, name: who.name, email: who.email },
      now,
    );
    const t = tables(stores.app);
    const held = await dbGet<{ publicKey: string }>(
      stores.app,
      sql`SELECT public_key AS "publicKey" FROM ${t.accountKey} WHERE account_id = ${user.id}`,
    );
    let publicKey: Uint8Array;
    if (held) publicKey = Buffer.from(held.publicKey, 'base64url');
    else {
      const pair = await generateX25519(true);
      const privateBytes = await exportX25519Private(pair.privateKey);
      await createAccountKey(
        stores.app,
        user.id,
        toBase64Url(pair.publicKey),
        [
          {
            method: 'password',
            params: `argon2id:${PASSWORD_V1.version}`,
            wrapped: await wrapToSecret(privateBytes, values.unwrap, 'password', [user.id, 1]),
          },
        ],
        now,
      );
      privateBytes.fill(0);
      publicKey = pair.publicKey;
    }
    people[who.key] = { accountId: user.id, personId: person.id, publicKey };
  }
  return people;
}

/** One group: made by Ada, its key wrapped to every member with an account, its members added; then what it holds. Left alone if it is there. */
async function group(
  stores: SeedStores,
  people: Record<Key, Person>,
  spec: {
    id: string;
    name: string;
    color: string;
    currency: string;
    members: Key[];
    placeholder?: { name: string; email: string };
  },
  now: number,
): Promise<{ key: CryptoKey; members: Record<string, string>; order: string[] } | undefined> {
  const t = tables(stores.app);
  const there = await dbGet<{ id: string }>(
    stores.app,
    sql`SELECT id FROM ${t.grp} WHERE id = ${spec.id}`,
  );
  if (there) return undefined;
  const raw = newGroupKey();
  const key = await importGroupKey(raw);
  const ada = people.ada;
  const wrapFor = (who: Person) => wrapToPublicKey(raw, who.publicKey, [spec.id, 1, who.accountId]);
  await createGroup(
    stores.app,
    ada,
    {
      groupId: spec.id,
      sealed: await sealRow({ name: spec.name }, key, 1, {
        group: spec.id,
        table: 'grp',
        row: spec.id,
      }),
      color: spec.color,
      defaultCurrency: spec.currency,
      keyWrap: await wrapFor(ada),
    },
    now,
  );
  for (const k of spec.members.filter((m) => m !== 'ada')) {
    const who = PEOPLE.find((p) => p.key === k);
    if (!who) continue;
    await addPerson(stores.app, ada, { groupId: spec.id, email: who.email }, now);
    await dbAll(
      stores.app,
      sql`INSERT INTO ${t.keyWrap} (group_id, epoch, account_id, wrapped, wrapped_by, created_at)
          VALUES (${spec.id}, 1, ${people[k].accountId}, ${await wrapFor(people[k])}, ${ada.accountId}, ${now})
          ON CONFLICT (group_id, epoch, account_id) DO NOTHING RETURNING group_id`,
    );
  }
  if (spec.placeholder) {
    const added = await addPerson(stores.app, ada, { groupId: spec.id, ...spec.placeholder }, now);
    await createInvitation(
      stores.app,
      ada,
      { groupId: spec.id, personId: added.personId },
      { now },
    );
  }
  const rows = await dbAll<{ id: string; personId: string; joinedAt: number }>(
    stores.app,
    sql`SELECT id, person_id AS "personId", joined_at AS "joinedAt" FROM ${t.member} WHERE group_id = ${spec.id}`,
  );
  const members: Record<string, string> = {};
  for (const r of rows) {
    const k = (Object.keys(people) as Key[]).find((p) => people[p].personId === r.personId);
    members[k ?? 'placeholder'] = r.id;
  }
  return {
    key,
    members,
    order: memberOrder(rows.map((r) => ({ id: r.id, joinedAt: Number(r.joinedAt) }))),
  };
}

/** Applies a mutation as someone, and says if the app refused it: the seed is held to every check a change is. */
async function apply(stores: SeedStores, who: Person, mutation: Mutation, now: number) {
  const applied = await applyMutation(stores.app, who, mutation, now);
  if (applied.status !== 'applied')
    throw new Error(`the seed was refused: ${applied.refusal.code}`);
}

export async function runSeed(stores: SeedStores, url: string, secret: string, now = Date.now()) {
  const people = await accounts(stores, url, secret, now);
  const { ada, grace, lee } = people;
  const m = (value: number) => toMinor(value);

  // Lisbon trip: euros and yen, every split method, two payers, a conflict, comments, payments; simplify debts off.
  const lisbon = await group(
    stores,
    people,
    {
      id: GROUPS.lisbon,
      name: 'Lisbon trip',
      color: '#2563eb',
      currency: 'EUR',
      members: ['ada', 'grace', 'lee'],
      placeholder: { name: 'Sam', email: 'sam@example.test' },
    },
    now,
  );
  if (lisbon) {
    const { key, members, order } = lisbon;
    const [a, g, l, s] = [
      members.ada ?? '',
      members.grace ?? '',
      members.lee ?? '',
      members.placeholder ?? '',
    ];
    const expense = async (
      name: string,
      who: Person,
      text: { description: string; note: string | null },
      intent: Omit<ExpenseIntent, 'sealed'>,
    ) => {
      const expenseId = id(`expense:${name}`);
      const row = expenseRow(
        {
          ...intent,
          sealed: await sealRow(text, key, 1, {
            group: GROUPS.lisbon,
            table: 'expense',
            row: expenseId,
          }),
        },
        order,
      );
      if (!row.ok) throw new Error(`the seed's ${name} does not add up`);
      await apply(
        stores,
        who,
        addExpense({
          mutationId: id(`mutation:${name}`),
          groupId: GROUPS.lisbon,
          expenseId,
          row: row.value,
        }),
        now,
      );
      return { expenseId, intent };
    };
    const dinner = await expense(
      'dinner',
      ada,
      { description: 'Dinner at Ramiro', note: 'The seafood one, after the tram.' },
      {
        amount: m(12_840),
        currency: 'EUR',
        date: '2026-10-03',
        category: 'eating_out',
        method: 'equal',
        payers: [{ memberId: a, amount: m(12_840) }],
        split: [a, g, l, s].map((memberId) => ({ memberId, units: null })),
      },
    );
    await expense(
      'hotel',
      grace,
      { description: 'Hotel, three nights', note: null },
      {
        amount: m(54_000),
        currency: 'EUR',
        date: '2026-10-02',
        category: 'travel',
        method: 'amounts',
        payers: [{ memberId: g, amount: m(54_000) }],
        split: [
          { memberId: a, units: 18_000 },
          { memberId: g, units: 18_000 },
          { memberId: l, units: 18_000 },
        ],
      },
    );
    await expense(
      'car',
      lee,
      { description: 'Car to Sintra', note: 'Lee drove, so less for Lee.' },
      {
        amount: m(9_000),
        currency: 'EUR',
        date: '2026-10-04',
        category: 'transport',
        method: 'percentages',
        payers: [{ memberId: l, amount: m(9_000) }],
        split: [
          { memberId: a, units: 4_000 },
          { memberId: g, units: 4_000 },
          { memberId: l, units: 2_000 },
        ],
      },
    );
    await expense(
      'groceries',
      ada,
      { description: 'Groceries for the flat', note: null },
      {
        amount: m(4_750),
        currency: 'EUR',
        date: '2026-10-02',
        category: 'groceries',
        method: 'shares',
        payers: [{ memberId: a, amount: m(4_750) }],
        split: [
          { memberId: a, units: 2 },
          { memberId: g, units: 1 },
          { memberId: l, units: 1 },
          { memberId: s, units: 1 },
        ],
      },
    );
    await expense(
      'museum',
      grace,
      { description: 'Gulbenkian Museum', note: null },
      {
        amount: m(6_000),
        currency: 'EUR',
        date: '2026-10-05',
        category: 'entertainment',
        method: 'equal',
        payers: [
          { memberId: a, amount: m(2_500) },
          { memberId: g, amount: m(3_500) },
        ],
        split: [a, g, l].map((memberId) => ({ memberId, units: null })),
      },
    );
    await expense(
      'sushi',
      lee,
      { description: 'Sushi at the stopover', note: 'In Tokyo, on the way.' },
      {
        amount: m(9_600),
        currency: 'JPY',
        date: '2026-10-01',
        category: 'eating_out',
        method: 'equal',
        payers: [{ memberId: l, amount: m(9_600) }],
        split: [a, g, l].map((memberId) => ({ memberId, units: null })),
      },
    );
    // A conflict: Grace and Ada each change the dinner from the same version; Ada's reached the server later and stands, and Grace's is kept as replaced.
    for (const [who, amount, mutation] of [
      [grace, 13_200, 'dinner:grace'],
      [ada, 13_000, 'dinner:ada'],
    ] as const) {
      const row = expenseRow(
        {
          ...dinner.intent,
          amount: m(amount),
          payers: [{ memberId: a, amount: m(amount) }],
          sealed: await sealRow(
            { description: 'Dinner at Ramiro', note: 'The seafood one, with the tip.' },
            key,
            1,
            {
              group: GROUPS.lisbon,
              table: 'expense',
              row: dinner.expenseId,
            },
          ),
        },
        order,
      );
      if (!row.ok) throw new Error('the seed’s edit does not add up');
      await apply(
        stores,
        who,
        editExpense({
          mutationId: id(`mutation:${mutation}`),
          groupId: GROUPS.lisbon,
          current: { id: dinner.expenseId, version: 1 },
          row: row.value,
        }),
        now,
      );
    }
    for (const [name, who, body] of [
      ['comment:grace', grace, 'Worth every cent.'],
      ['comment:lee', lee, 'I still owe you for the wine, Ada.'],
    ] as const) {
      const commentId = id(name);
      await apply(
        stores,
        who,
        addComment({
          mutationId: id(`mutation:${name}`),
          groupId: GROUPS.lisbon,
          commentId,
          subject: 'expense',
          subjectId: dinner.expenseId,
          sealed: await sealRow({ body }, key, 1, {
            group: GROUPS.lisbon,
            table: 'comment',
            row: commentId,
          }),
        }),
        now,
      );
    }
    const paymentId = id('payment:lee-ada');
    await apply(
      stores,
      lee,
      addPayment({
        mutationId: id('mutation:payment:lee-ada'),
        groupId: GROUPS.lisbon,
        paymentId,
        row: {
          sealed: await sealRow({ note: 'For the dinner' }, key, 1, {
            group: GROUPS.lisbon,
            table: 'payment',
            row: paymentId,
          }),
          fromMemberId: l,
          toMemberId: a,
          amount: m(2_000),
          currency: 'EUR',
          date: '2026-10-06',
        },
      }),
      now,
    );
  }

  // Flat: two people, rent and bills, simplify debts on.
  const flat = await group(
    stores,
    people,
    { id: GROUPS.flat, name: 'Flat', color: '#16a34a', currency: 'EUR', members: ['ada', 'grace'] },
    now,
  );
  if (flat) {
    const { key, members, order } = flat;
    const [a, g] = [members.ada ?? '', members.grace ?? ''];
    await setSimplifyDebts(stores.app, ada, { groupId: GROUPS.flat, on: true }, now);
    for (const [name, who, payer, description, amount, date, category] of [
      ['rent', grace, g, 'Rent, November', 120_000, '2026-11-01', 'rent'],
      ['power', ada, a, 'Electricity', 8_430, '2026-11-03', 'utilities'],
      ['internet', ada, a, 'Internet', 3_500, '2026-11-05', 'utilities'],
    ] as const) {
      const expenseId = id(`expense:${name}`);
      const row = expenseRow(
        {
          sealed: await sealRow({ description, note: null }, key, 1, {
            group: GROUPS.flat,
            table: 'expense',
            row: expenseId,
          }),
          amount: m(amount),
          currency: 'EUR',
          date,
          category,
          method: 'equal',
          payers: [{ memberId: payer, amount: m(amount) }],
          split: [a, g].map((memberId) => ({ memberId, units: null })),
        },
        order,
      );
      if (!row.ok) throw new Error(`the seed's ${name} does not add up`);
      await apply(
        stores,
        who,
        addExpense({
          mutationId: id(`mutation:${name}`),
          groupId: GROUPS.flat,
          expenseId,
          row: row.value,
        }),
        now,
      );
    }
  }

  // Ski weekend: settled, then closed.
  const ski = await group(
    stores,
    people,
    {
      id: GROUPS.ski,
      name: 'Ski weekend',
      color: '#7c3aed',
      currency: 'EUR',
      members: ['ada', 'lee'],
    },
    now,
  );
  if (ski) {
    const { key, members, order } = ski;
    const [a, l] = [members.ada ?? '', members.lee ?? ''];
    const expenseId = id('expense:lift');
    const row = expenseRow(
      {
        sealed: await sealRow({ description: 'Lift passes', note: null }, key, 1, {
          group: GROUPS.ski,
          table: 'expense',
          row: expenseId,
        }),
        amount: m(18_000),
        currency: 'EUR',
        date: '2026-02-14',
        category: 'entertainment',
        method: 'equal',
        payers: [{ memberId: a, amount: m(18_000) }],
        split: [a, l].map((memberId) => ({ memberId, units: null })),
      },
      order,
    );
    if (!row.ok) throw new Error('the seed’s lift passes do not add up');
    await apply(
      stores,
      ada,
      addExpense({
        mutationId: id('mutation:lift'),
        groupId: GROUPS.ski,
        expenseId,
        row: row.value,
      }),
      now,
    );
    await apply(
      stores,
      lee,
      addPayment({
        mutationId: id('mutation:payment:lee-ski'),
        groupId: GROUPS.ski,
        paymentId: id('payment:lee-ski'),
        row: {
          sealed: null,
          fromMemberId: l,
          toMemberId: a,
          amount: m(9_000),
          currency: 'EUR',
          date: '2026-02-20',
        },
      }),
      now,
    );
    await closeGroup(stores.app, ada, { groupId: GROUPS.ski }, now);
  }
  return people;
}

/** Takes the seeded accounts away, and with them their groups and placeholders (`deletePerson`). */
export async function removeSeed(stores: SeedStores, now = Date.now()) {
  for (const who of [...PEOPLE].reverse()) {
    const user = await dbGet<{ id: string }>(
      stores.auth,
      sql`SELECT id FROM ${authTables(stores.auth).user} WHERE email = ${who.email}`,
    );
    if (user)
      await deletePerson(
        { database: stores.app, authDatabase: stores.auth, now: () => now },
        user.id,
      );
  }
}

export async function main(args: readonly string[]): Promise<number> {
  const result = loadConfig(processEnv());
  if (!result.ok) {
    console.error(`[tally] seed: the settings are wrong: ${result.problems.join(' ')}`);
    return 1;
  }
  const { config } = result;
  const secret = config.auth?.secret;
  if (!config.url || !secret || !isLocal(config.url, config.database.database)) {
    console.error(
      '[tally] seed: this makes accounts whose password is written in scripts/seed.ts, so it runs only against this machine: a local TALLY_URL, TALLY_AUTH_SECRET, and a local database.',
    );
    return 1;
  }
  const stores = await getStores(config.database);
  try {
    if (args.includes('--reset')) await removeSeed(stores);
    await runSeed(stores, config.url, secret);
    console.info(
      `[tally] seed: ${PEOPLE.map((p) => p.email).join(', ')}, each with the password "${SEED_PASSWORD}". Groups: Lisbon trip, Flat, Ski weekend.`,
    );
    return 0;
  } finally {
    await stores.close();
  }
}
