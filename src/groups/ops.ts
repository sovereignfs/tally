import { sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { dbAll, dbGet, transaction } from '../db/exec';
import { tables } from '../db/tables';
import { recordActivity } from '../activity/record';
import { activeMemberOf, ownerOf } from '../access/membership';
import { parseSealed } from '../cipher/seal';
import { checkWrapped } from '../keys/store';
import { isSupportedCurrencyCode } from '../money/currencies';
import { type PersonView, viewPerson } from '../people/visibility';
import { isGroupColor } from './colors';

/**
 * **The online operations of a group** (DESIGN.md §7, §11.6): decided by the server at once, each in one short transaction, **the permission in its
 * statements** (`activeMemberOf`, `ownerOf`), each moving the group's `seq` on so that devices pull the change. A group the account is not an active
 * member of, or not an owner of for an owner's operation, reads as not found and nothing is touched. A rule that holds (the last owner, a limit) is said
 * in a sentence. The name is sealed in the browser and checked here for its form alone (§5.3).
 */
export const MAX_MEMBERS = 50;
export const MAX_GROUPS = 200;
/** The longest a sealed name may be: a hundred characters, sealed and padded, with room to spare. */
export const MAX_SEALED_NAME = 1024;

export class OpError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid' | 'id_taken' | 'last_owner' | 'too_many_groups',
    readonly sentence?: string,
  ) {
    super(sentence ?? code);
    this.name = 'OpError';
  }
}

export type Role = 'owner' | 'member';
export type NotifyChoice = 'all' | 'involved' | 'none';
const NOTIFY: readonly NotifyChoice[] = ['all', 'involved', 'none'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface GroupState {
  group: {
    id: string;
    sealed: string;
    color: string;
    defaultCurrency: string;
    simplifyDebts: boolean;
    closedAt: number | null;
    keyEpoch: number;
    seq: number;
  };
  members: (PersonView & {
    memberId: string;
    role: Role | null;
    joinedAt: number;
    leftAt: number | null;
  })[];
  /** The reader's own place: their membership, role and what they hear. */
  me: { memberId: string; role: Role | null; notify: NotifyChoice };
}

interface Who {
  accountId: string;
  personId: string;
}

function checkSealedName(value: unknown, epochAtMost: number): string {
  if (typeof value !== 'string' || value.length > MAX_SEALED_NAME) throw new OpError('invalid');
  let epoch: number;
  try {
    epoch = parseSealed(value).epoch;
  } catch {
    throw new OpError('invalid');
  }
  if (epoch > epochAtMost) throw new OpError('invalid');
  return value;
}

const string = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100)
    throw new OpError('invalid');
  return value;
};

/** The group as the reader may see it, or not found. Every read of it carries the reader's membership in its statement. */
export async function readGroup(
  database: Database,
  who: Who,
  groupId: string,
): Promise<GroupState> {
  const t = tables(database);
  const group = await dbGet<GroupState['group'] & { simplifyDebts: boolean | number }>(
    database,
    sql`SELECT id, sealed, color, default_currency AS "defaultCurrency", simplify_debts AS "simplifyDebts", closed_at AS "closedAt",
               key_epoch AS "keyEpoch", seq
        FROM ${t.grp} WHERE id = ${groupId} AND ${activeMemberOf(database, groupId, who.accountId)}`,
  );
  if (!group) throw new OpError('not_found');
  const rows = await dbAll<{
    memberId: string;
    role: Role | null;
    notify: NotifyChoice;
    joinedAt: number;
    leftAt: number | null;
    personId: string;
    accountId: string | null;
    addedBy: string | null;
    name: string;
    email: string | null;
    deletedAt: number | null;
  }>(
    database,
    sql`SELECT m.id AS "memberId", m.role, m.notify, m.joined_at AS "joinedAt", m.left_at AS "leftAt", p.id AS "personId",
               p.account_id AS "accountId", p.added_by AS "addedBy", p.name, p.email, p.deleted_at AS "deletedAt"
        FROM ${t.member} m JOIN ${t.person} p ON p.id = m.person_id
        WHERE m.group_id = ${groupId} AND ${activeMemberOf(database, groupId, who.accountId)}
        ORDER BY m.joined_at, m.id`,
  );
  const mine = rows.find((row) => row.personId === who.personId && row.leftAt === null);
  if (!mine) throw new OpError('not_found');
  const owner = mine.role === 'owner';
  const viewer = { accountId: who.accountId, personId: who.personId };
  return {
    group: { ...group, simplifyDebts: Boolean(group.simplifyDebts) },
    members: rows.map((row) => ({
      ...viewPerson(
        viewer,
        {
          id: row.personId,
          accountId: row.accountId,
          addedBy: row.addedBy,
          name: row.name,
          email: row.email,
          deletedAt: row.deletedAt,
        },
        {
          // An owner sees the email of everyone still in the group (§6.1).
          ownsAGroupTheyAreIn: owner && row.leftAt === null,
        },
      ),
      memberId: row.memberId,
      role: row.role,
      joinedAt: row.joinedAt,
      leftAt: row.leftAt,
    })),
    me: { memberId: mine.memberId, role: mine.role, notify: mine.notify },
  };
}

/**
 * **Makes a group** (DESIGN.md §7.1), its creator its first owner. The browser made its id, so that the name it sealed and the key it wrapped are
 * bound to it (§5.3); an id that is another group's is refused. `keyWrap` is the group's first key, epoch 1, wrapped to the creator's account key.
 */
export async function createGroup(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
): Promise<GroupState> {
  const groupId = string(input.groupId);
  if (!UUID.test(groupId)) throw new OpError('invalid');
  const sealed = checkSealedName(input.sealed, 1);
  const color = input.color;
  const currency = input.defaultCurrency;
  if (!isGroupColor(color) || typeof currency !== 'string' || !isSupportedCurrencyCode(currency))
    throw new OpError('invalid');
  let keyWrap: string;
  try {
    keyWrap = checkWrapped(input.keyWrap);
  } catch {
    throw new OpError('invalid');
  }
  const t = tables(database);
  await transaction(database, async (tx) => {
    const groups = await dbGet<{ n: number }>(
      tx,
      sql`SELECT COUNT(*) AS n FROM ${t.member} WHERE person_id = ${who.personId} AND left_at IS NULL`,
    );
    if (Number(groups?.n ?? 0) >= MAX_GROUPS) {
      throw new OpError(
        'too_many_groups',
        `You are in ${MAX_GROUPS} groups, which is as many as one person can be in. Close one to make another.`,
      );
    }
    const made = await dbAll<{ id: string }>(
      tx,
      sql`INSERT INTO ${t.grp} (id, sealed, color, default_currency, simplify_debts, closed_at, key_epoch, seq, created_by, created_at, updated_at)
          VALUES (${groupId}, ${sealed}, ${color}, ${currency}, ${false}, NULL, 1, 1, ${who.personId}, ${now}, ${now})
          ON CONFLICT (id) DO NOTHING RETURNING id`,
    );
    if (made.length === 0) throw new OpError('id_taken');
    await dbAll(
      tx,
      sql`INSERT INTO ${t.member} (id, group_id, person_id, role, notify, added_by, joined_at, left_at, seq)
          VALUES (${crypto.randomUUID()}, ${groupId}, ${who.personId}, 'owner', 'all', ${who.personId}, ${now}, NULL, 1)`,
    );
    await dbAll(
      tx,
      sql`INSERT INTO ${t.keyWrap} (group_id, epoch, account_id, wrapped, wrapped_by, created_at)
          VALUES (${groupId}, 1, ${who.accountId}, ${keyWrap}, ${who.accountId}, ${now})`,
    );
    await recordActivity(tx, {
      groupId,
      actorPersonId: who.personId,
      kind: 'group_created',
      subjectId: groupId,
      details: { sealed },
      now,
    });
  });
  return readGroup(database, who, groupId);
}

/**
 * An owner's change to the group's own row, in one statement that carries the owner's role and that the group is open, and moves `seq` on.
 * Nothing changes, and the answer is not found, for anyone else.
 */
async function updateAsOwner(
  database: Database,
  who: Who,
  groupId: string,
  set: ReturnType<typeof sql>,
  now: number,
  line?: OwnerActivity | ((tx: Database) => Promise<OwnerActivity>),
) {
  const t = tables(database);
  await transaction(database, async (tx) => {
    // A line that says what was there before reads it in the same transaction, before the change.
    const activity = typeof line === 'function' ? await line(tx) : line;
    const done = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${t.grp} SET ${set}, seq = seq + 1, updated_at = ${now}
          WHERE id = ${groupId} AND closed_at IS NULL AND ${ownerOf(tx, groupId, who.accountId)} RETURNING id`,
    );
    if (done.length === 0) throw new OpError('not_found');
    if (activity)
      await recordActivity(tx, {
        ...activity,
        groupId,
        actorPersonId: who.personId,
        subjectId: groupId,
        now,
      } as Parameters<typeof recordActivity>[1]);
  });
  return readGroup(database, who, groupId);
}

/** The activity line of an owner's change to the group's own row, written in its transaction. */
type OwnerActivity =
  | { kind: 'group_renamed'; details: { sealed: string } }
  | { kind: 'group_currency_changed'; details: { from: string; to: string } }
  | { kind: 'group_simplify_changed'; details: { on: boolean } };

export async function renameGroup(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  const groupId = string(input.groupId);
  const t = tables(database);
  const current = await dbGet<{ keyEpoch: number }>(
    database,
    sql`SELECT key_epoch AS "keyEpoch" FROM ${t.grp} WHERE id = ${groupId} AND ${ownerOf(database, groupId, who.accountId)}`,
  );
  if (!current) throw new OpError('not_found');
  const sealed = checkSealedName(input.sealed, current.keyEpoch);
  return updateAsOwner(database, who, groupId, sql`sealed = ${sealed}`, now, {
    kind: 'group_renamed',
    details: { sealed },
  });
}

export async function recolourGroup(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  const groupId = string(input.groupId);
  if (!isGroupColor(input.color)) throw new OpError('invalid');
  return updateAsOwner(database, who, groupId, sql`color = ${input.color}`, now);
}

export async function changeCurrency(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  const groupId = string(input.groupId);
  const currency = input.defaultCurrency;
  if (typeof currency !== 'string' || !isSupportedCurrencyCode(currency))
    throw new OpError('invalid');
  return updateAsOwner(
    database,
    who,
    groupId,
    sql`default_currency = ${currency}`,
    now,
    async (tx) => {
      const before = await dbGet<{ currency: string }>(
        tx,
        sql`SELECT default_currency AS currency FROM ${tables(tx).grp} WHERE id = ${groupId}`,
      );
      return {
        kind: 'group_currency_changed',
        details: { from: before?.currency ?? currency, to: currency },
      };
    },
  );
}

export async function setSimplifyDebts(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  const groupId = string(input.groupId);
  if (typeof input.on !== 'boolean') throw new OpError('invalid');
  return updateAsOwner(database, who, groupId, sql`simplify_debts = ${input.on}`, now, {
    kind: 'group_simplify_changed',
    details: { on: input.on },
  });
}

/**
 * **Makes a member an owner, or an owner a member** (DESIGN.md §7.2), an owner's operation. **A group always has an owner:** the last one cannot step
 * down or be made a member until another is an owner, which is said in a sentence. A placeholder holds no role.
 */
export async function setRole(
  database: Database,
  who: Who,
  input: Record<string, unknown>,
  now = Date.now(),
) {
  const groupId = string(input.groupId);
  const memberId = string(input.memberId);
  const role = input.role;
  if (role !== 'owner' && role !== 'member') throw new OpError('invalid');
  const t = tables(database);
  await transaction(database, async (tx) => {
    const moved = await dbAll<{ seq: number }>(
      tx,
      sql`UPDATE ${t.grp} SET seq = seq + 1, updated_at = ${now}
          WHERE id = ${groupId} AND closed_at IS NULL AND ${ownerOf(tx, groupId, who.accountId)} RETURNING seq`,
    );
    const seq = moved[0]?.seq;
    if (seq === undefined) throw new OpError('not_found');
    // The last owner is held in the same statement: making someone a member needs another owner still there after it.
    const changed = await dbAll<{ id: string }>(
      tx,
      sql`UPDATE ${t.member} SET role = ${role}, seq = ${seq}
          WHERE id = ${memberId} AND group_id = ${groupId} AND left_at IS NULL AND role IS NOT NULL
            AND (${role} = 'owner' OR EXISTS (SELECT 1 FROM ${t.member} other
                 WHERE other.group_id = ${groupId} AND other.id <> ${memberId} AND other.left_at IS NULL AND other.role = 'owner'))
          RETURNING id`,
    );
    if (changed.length === 0) {
      const target = await dbGet<{ role: string | null }>(
        tx,
        sql`SELECT role FROM ${t.member} WHERE id = ${memberId} AND group_id = ${groupId} AND left_at IS NULL AND role IS NOT NULL`,
      );
      if (target?.role === 'owner') {
        throw new OpError(
          'last_owner',
          'A group always has an owner. Make someone else an owner first.',
        );
      }
      throw new OpError('not_found');
    }
    const target = await dbGet<{ personId: string }>(
      tx,
      sql`SELECT person_id AS "personId" FROM ${t.member} WHERE id = ${memberId} AND group_id = ${groupId}`,
    );
    await recordActivity(tx, {
      groupId,
      actorPersonId: who.personId,
      kind: 'role_changed',
      subjectId: memberId,
      details: { memberId, personId: target?.personId ?? '', role },
      now,
    });
  });
  return readGroup(database, who, groupId);
}

/** What the reader hears of this group (DESIGN.md §12.2): their own choice, for themselves alone. */
export async function setNotify(database: Database, who: Who, input: Record<string, unknown>) {
  const groupId = string(input.groupId);
  const choice = input.notify;
  if (typeof choice !== 'string' || !(NOTIFY as readonly string[]).includes(choice))
    throw new OpError('invalid');
  const t = tables(database);
  const done = await dbAll<{ id: string }>(
    database,
    sql`UPDATE ${t.member} SET notify = ${choice}
        WHERE group_id = ${groupId} AND person_id = ${who.personId} AND left_at IS NULL RETURNING id`,
  );
  if (done.length === 0) throw new OpError('not_found');
  return readGroup(database, who, groupId);
}

/** Every operation, by the name a request gives (`POST /api/ops`). */
export const OPERATIONS = {
  'group.read': (db: Database, who: Who, input: Record<string, unknown>) =>
    readGroup(db, who, string(input.groupId)),
  'group.create': createGroup,
  'group.rename': renameGroup,
  'group.recolour': recolourGroup,
  'group.currency': changeCurrency,
  'group.simplify': setSimplifyDebts,
  'member.role': setRole,
  'member.notify': setNotify,
} as const;

export type OperationName = keyof typeof OPERATIONS;
