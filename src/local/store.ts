import type { IDBPTransaction } from 'idb';
import type { Change, Mutation } from '../actions/types';
import {
  type GroupContext,
  type Refusal,
  checkComment,
  checkExpense,
  checkPayment,
  parseMutation,
} from '../actions/validate';
import { computeShares, memberOrder } from '../money/split';
import type { MutationResult, SyncResponse } from '../sync/format';
import type {
  FailedEntry,
  LocalComment,
  LocalDatabase,
  LocalExpense,
  LocalGroup,
  LocalMember,
  LocalPayment,
  LocalSchema,
  LocalTable,
  OutboxEntry,
} from './db';

/**
 * **Reading and writing the device's store** (DESIGN.md §11.1–§11.3). A write (`commit`) is checked by the validators the server runs, against the
 * group as the device holds it, then applied to the rows and queued in the outbox **in one IndexedDB transaction**, so that closing the tab at any
 * moment loses neither. Settling a sync's answer (`settle`) takes back every unanswered change, moves answered mutations out of the outbox (a refused
 * one to `failed`, with its reason), lays the server's rows down, and applies the changes still waiting on top again. Tusk's Desk store, simplified:
 * an expense or payment travels whole, so a row's changes are laid over whole too, with no field to merge.
 */
export class LocalRefusal extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.code);
    this.name = 'LocalRefusal';
  }
}

type RowTable = 'expense' | 'payment' | 'comment';
type AnyRow = LocalExpense | LocalPayment | LocalComment;

const touched = (change: Change): [RowTable, string] => [change.table, change.id];

/** The group as the device holds it, for the validators. */
async function contextOf(
  db: LocalDatabase,
  groupId: string,
): Promise<{ group: LocalGroup; context: GroupContext } | undefined> {
  const group = await db.get('grp', groupId);
  if (!group) return undefined;
  const members = await db.getAllFromIndex('member', 'byGroup', groupId);
  return {
    group,
    context: {
      order: memberOrder(members.map((m) => ({ id: m.id, joinedAt: m.joinedAt }))),
      active: new Set(members.filter((m) => m.leftAt === null).map((m) => m.id)),
      epoch: group.keyEpoch,
    },
  };
}

/** Checks a mutation as the server will, against the device's copy of its group, so that one the server would refuse is never queued. */
export async function checkLocally(db: LocalDatabase, raw: unknown): Promise<Mutation> {
  const parsed = parseMutation(raw);
  if (!parsed.ok) throw new LocalRefusal(parsed.refusal);
  const mutation = parsed.value;
  const found = await contextOf(db, mutation.groupId);
  if (!found) throw new LocalRefusal({ code: 'not_found' });
  if (found.group.closedAt !== null) throw new LocalRefusal({ code: 'closed' });
  for (const change of mutation.changes) {
    if (change.op !== 'put') continue;
    if (change.table === 'comment') {
      const checked = checkComment(change.row, found.context);
      if (!checked.ok) throw new LocalRefusal(checked.refusal);
      continue;
    }
    const stored = await db.get(change.table, change.id);
    const onVersion = new Set<string>(
      !stored
        ? []
        : 'payers' in stored
          ? [...stored.payers.map((p) => p.memberId), ...stored.shares.map((s) => s.memberId)]
          : [stored.fromMemberId, stored.toMemberId],
    );
    const checked =
      change.table === 'expense'
        ? checkExpense(change.row, found.context, onVersion)
        : checkPayment(change.row, found.context, onVersion);
    if (!checked.ok) throw new LocalRefusal(checked.refusal);
  }
  return mutation;
}

/**
 * A mutation's effect on the device's rows, as the server is expected to make it: an edit replaces the row whole and is versioned one on, a delete
 * marks it, a restore unmarks it, a comment is made or marked. `actorPersonId` is who the device is.
 */
export function applyChange(
  current: AnyRow | undefined,
  change: Change,
  groupId: string,
  actorPersonId: string,
  now: number,
): AnyRow | undefined {
  if (change.table === 'comment') {
    if (change.op === 'delete')
      return current ? { ...(current as LocalComment), deletedAt: now } : undefined;
    return {
      id: change.id,
      groupId,
      subject: change.row.subject,
      subjectId: change.row.subjectId,
      authorPersonId: actorPersonId,
      sealed: change.row.sealed,
      deletedAt: null,
      createdAt: (current as LocalComment | undefined)?.createdAt ?? now,
      seq: current?.seq ?? 0,
    };
  }
  if (change.op === 'delete' || change.op === 'restore') {
    if (!current) return undefined;
    const row = current as LocalExpense | LocalPayment;
    const deletedAt = change.op === 'delete' ? (row.deletedAt ?? now) : null;
    if (deletedAt === row.deletedAt) return row;
    return {
      ...row,
      deletedAt,
      version: row.version + 1,
      updatedBy: actorPersonId,
      updatedAt: now,
    };
  }
  if (change.op !== 'put') return current;
  const before = current as LocalExpense | LocalPayment | undefined;
  const common = {
    id: change.id,
    groupId,
    version: (before?.version ?? 0) + 1,
    createdBy: before?.createdBy ?? actorPersonId,
    updatedBy: actorPersonId,
    deletedAt: null,
    createdAt: before?.createdAt ?? now,
    updatedAt: now,
    seq: before?.seq ?? 0,
  };
  if (change.table === 'expense')
    return {
      ...common,
      sealed: change.row.sealed,
      amount: change.row.amount,
      currency: change.row.currency,
      date: change.row.date,
      category: change.row.category,
      method: change.row.method,
      payers: change.row.payers.map((p) => ({ memberId: p.memberId, amount: p.amount })),
      shares: change.row.shares.map((s) => ({
        memberId: s.memberId,
        amount: s.amount,
        units: s.units,
      })),
    };
  return { ...common, ...change.row };
}

const ALL = [
  'grp',
  'member',
  'expense',
  'payment',
  'comment',
  'shadow',
  'outbox',
  'failed',
  'meta',
] as const;
type Tx = IDBPTransaction<LocalSchema, (typeof ALL)[number][], 'readwrite'>;

/** Applies a mutation's changes to the rows inside `tx`, keeping each touched row's server copy in `shadow` first. */
async function layOver(tx: Tx, mutation: Mutation, actorPersonId: string, now: number) {
  for (const change of mutation.changes) {
    const [table, id] = touched(change);
    const store = tx.objectStore(table) as unknown as {
      get(id: string): Promise<AnyRow | undefined>;
      put(row: AnyRow): Promise<unknown>;
    };
    const current = await store.get(id);
    const shadows = tx.objectStore('shadow');
    if (!(await shadows.get([table, id]))) await shadows.put({ table, id, row: current ?? null });
    const next = applyChange(current, change, mutation.groupId, actorPersonId, now);
    if (next) await store.put(next);
  }
}

/** Writes a checked mutation to the rows and the outbox, as one transaction. */
export async function commitMutation(
  db: LocalDatabase,
  mutation: Mutation,
  actorPersonId: string,
  now: number,
): Promise<void> {
  const tx = db.transaction(ALL, 'readwrite');
  await layOver(tx, mutation, actorPersonId, now);
  await tx.objectStore('outbox').add({ mutation, queuedAt: now });
  await tx.done;
}

export const cursorKey = (groupId: string) => `cursor:${groupId}`;

export async function readCursors(db: LocalDatabase): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const group of await db.getAll('grp')) {
    const at = await db.get('meta', cursorKey(group.id));
    out[group.id] = typeof at === 'number' ? at : 0;
  }
  return out;
}

export async function readOutbox(db: LocalDatabase, limit?: number): Promise<OutboxEntry[]> {
  const all = await db.getAll('outbox');
  return limit === undefined ? all : all.slice(0, limit);
}

export const outboxSize = (db: LocalDatabase) => db.count('outbox');
export const readFailed = (db: LocalDatabase): Promise<FailedEntry[]> => db.getAll('failed');
export async function lastSyncedAt(db: LocalDatabase): Promise<number | null> {
  const at = await db.get('meta', 'lastSyncedAt');
  return typeof at === 'number' ? at : null;
}

/** What settling an answer did, for whoever is listening: the refusals, so that a screen can say so (a refused comment is undone with a toast). */
export interface Settled {
  refused: FailedEntry[];
  more: boolean;
}

/**
 * Takes a sync's answer: `sent` are the outbox entries the request carried, in order, which `answer.results` answers one for one. In one
 * transaction: every unanswered change taken back to the server's copy; the answered entries out of the outbox (refused ones kept in `failed`);
 * the server's rows and cursors laid down, gone groups removed; the entries still waiting applied on top again.
 */
export async function settle(
  db: LocalDatabase,
  sent: readonly OutboxEntry[],
  answer: SyncResponse,
  actorPersonId: string,
  now: number,
): Promise<Settled> {
  const tx = db.transaction(ALL, 'readwrite');
  const shadows = tx.objectStore('shadow');
  for (const shadow of await shadows.getAll()) {
    const store = tx.objectStore(shadow.table) as unknown as {
      put(row: unknown): Promise<unknown>;
      delete(id: string): Promise<void>;
    };
    if (shadow.row) await store.put(shadow.row);
    else await store.delete(shadow.id);
  }
  await shadows.clear();

  const refused: FailedEntry[] = [];
  sent.forEach((entry, i) => {
    const result: MutationResult | undefined = answer.results[i];
    if (!result || entry.n === undefined) return;
    if (result.status === 'refused')
      refused.push({
        mutationId: entry.mutation.mutationId,
        mutation: entry.mutation,
        refusal: result.refusal,
        failedAt: now,
      });
  });
  for (const [i, entry] of sent.entries())
    if (answer.results[i] && entry.n !== undefined) await tx.objectStore('outbox').delete(entry.n);
  // A refused comment is undone with a toast (§11.5), not kept: what was typed is short, and the screen says why. An expense or a payment is kept.
  for (const failed of refused)
    if (!failed.mutation.changes.every((c) => c.table === 'comment'))
      await tx.objectStore('failed').put(failed);

  for (const changes of answer.groups) {
    const groupId = changes.group.id;
    await tx.objectStore('grp').put(changes.group);
    for (const member of changes.members)
      await tx.objectStore('member').put({ ...member, groupId });
    for (const expense of changes.expenses)
      await tx.objectStore('expense').put({ ...expense, groupId });
    for (const payment of changes.payments)
      await tx.objectStore('payment').put({ ...payment, groupId });
    for (const comment of changes.comments)
      await tx.objectStore('comment').put({ ...comment, groupId });
    for (const gone of changes.tombstones)
      if (['member', 'expense', 'payment', 'comment'].includes(gone.table))
        await (
          tx.objectStore(gone.table as 'expense') as unknown as {
            delete(id: string): Promise<void>;
          }
        ).delete(gone.id);
    await tx.objectStore('meta').put(changes.cursor, cursorKey(groupId));
  }
  for (const groupId of answer.gone) {
    for (const table of ['member', 'expense', 'payment', 'comment'] as const) {
      const index = tx.objectStore(table).index('byGroup');
      for (const key of await index.getAllKeys(groupId)) await tx.objectStore(table).delete(key);
    }
    await tx.objectStore('grp').delete(groupId);
    await tx.objectStore('meta').delete(cursorKey(groupId));
  }

  for (const entry of await tx.objectStore('outbox').getAll())
    await layOver(tx, entry.mutation, actorPersonId, now);
  await tx.objectStore('meta').put(now, 'lastSyncedAt');
  await tx.done;
  return { refused, more: answer.groups.some((g) => g.more) };
}

/** Everything of one group, as screens read it. */
export async function readGroupRows(db: LocalDatabase, groupId: string) {
  const [group, members, expenses, payments, comments] = await Promise.all([
    db.get('grp', groupId),
    db.getAllFromIndex('member', 'byGroup', groupId),
    db.getAllFromIndex('expense', 'byGroup', groupId),
    db.getAllFromIndex('payment', 'byGroup', groupId),
    db.getAllFromIndex('comment', 'byGroup', groupId),
  ]);
  return { group, members: members as LocalMember[], expenses, payments, comments };
}

export const readGroups = (db: LocalDatabase): Promise<LocalGroup[]> => db.getAll('grp');

/** Which rows a pending mutation touches: whether a row on a screen is waiting to be sent (the clock mark, §15.5). */
export async function pendingRows(db: LocalDatabase): Promise<Set<string>> {
  return new Set((await db.getAll('shadow')).map((s) => `${s.table}:${s.id}`));
}

export type { LocalTable };

// ——— Couldn't sync (§11.5) ———

/** Discards a refused change: the person chose to. */
export async function discardFailed(db: LocalDatabase, mutationId: string): Promise<void> {
  await db.delete('failed', mutationId);
}

/** Sends a refused change again, as it was (the group reopened, the person is back): out of `failed`, into the outbox and the rows. */
export async function resendFailed(
  db: LocalDatabase,
  mutationId: string,
  actorPersonId: string,
  now: number,
): Promise<void> {
  const failed = await db.get('failed', mutationId);
  if (!failed) return;
  const mutation = await checkLocally(db, failed.mutation);
  const tx = db.transaction(ALL, 'readwrite');
  await tx.objectStore('failed').delete(mutationId);
  await layOver(tx, mutation, actorPersonId, now);
  await tx.objectStore('outbox').add({ mutation, queuedAt: now });
  await tx.done;
}

/** Re-seals a row's text for another row: opened with the source group's key, sealed under the target's newest (`GroupKeys`). */
export type Reseal = (
  sealed: string,
  from: { group: string; table: 'expense' | 'payment'; row: string },
  to: { group: string; table: 'expense' | 'payment'; row: string },
) => Promise<string>;

export class MoveRefused extends Error {
  constructor(
    readonly reason: 'not_movable' | 'missing_person' | 'no_group',
    readonly personId?: string,
  ) {
    super(reason);
    this.name = 'MoveRefused';
  }
}

/**
 * **Moves a refused expense or payment to another group** (§11.5): recorded there as new, with its people found in the target group by person (a
 * member of one group is the same person in another), its split worked out again by the target group's order, and its text sealed again for its new
 * row. Someone who is not in the target group refuses the move, naming them (`MoveRefused`). On success it is queued like any write and leaves `failed`.
 */
export async function moveFailed(
  db: LocalDatabase,
  mutationId: string,
  targetGroupId: string,
  reseal: Reseal,
  ids: { mutationId: string; rowId: string },
  actorPersonId: string,
  now: number,
): Promise<Mutation> {
  const failed = await db.get('failed', mutationId);
  const change = failed?.mutation.changes[0];
  if (
    !failed ||
    failed.mutation.changes.length !== 1 ||
    !change ||
    change.op !== 'put' ||
    change.table === 'comment'
  )
    throw new MoveRefused('not_movable');
  const source = await db.getAllFromIndex('member', 'byGroup', failed.mutation.groupId);
  const target = await db.getAllFromIndex('member', 'byGroup', targetGroupId);
  if (!(await db.get('grp', targetGroupId))) throw new MoveRefused('no_group');
  const personOf = new Map(source.map((m) => [m.id, m.personId]));
  const inTarget = new Map(target.filter((m) => m.leftAt === null).map((m) => [m.personId, m.id]));
  const map = (memberId: string): string => {
    const personId = personOf.get(memberId);
    const mapped = personId ? inTarget.get(personId) : undefined;
    if (!mapped) throw new MoveRefused('missing_person', personId);
    return mapped;
  };
  const from = { group: failed.mutation.groupId, table: change.table, row: change.id };
  const to = { group: targetGroupId, table: change.table, row: ids.rowId };
  const sealed = change.row.sealed === null ? null : await reseal(change.row.sealed, from, to);
  let moved: Mutation;
  if (change.table === 'expense') {
    const order = memberOrder(target.map((m) => ({ id: m.id, joinedAt: m.joinedAt })));
    const shares = computeShares(
      change.row.amount,
      change.row.method,
      change.row.shares.map((s) => ({ memberId: map(s.memberId), units: s.units })),
      order,
    );
    moved = {
      mutationId: ids.mutationId,
      groupId: targetGroupId,
      changes: [
        {
          table: 'expense',
          op: 'put',
          id: ids.rowId,
          baseVersion: null,
          row: {
            ...change.row,
            sealed: sealed ?? '',
            payers: change.row.payers.map((p) => ({ memberId: map(p.memberId), amount: p.amount })),
            shares,
          },
        },
      ],
    };
  } else {
    moved = {
      mutationId: ids.mutationId,
      groupId: targetGroupId,
      changes: [
        {
          table: 'payment',
          op: 'put',
          id: ids.rowId,
          baseVersion: null,
          row: {
            ...change.row,
            sealed,
            fromMemberId: map(change.row.fromMemberId),
            toMemberId: map(change.row.toMemberId),
          },
        },
      ],
    };
  }
  const checked = await checkLocally(db, moved);
  const tx = db.transaction(ALL, 'readwrite');
  await tx.objectStore('failed').delete(mutationId);
  await layOver(tx, checked, actorPersonId, now);
  await tx.objectStore('outbox').add({ mutation: checked, queuedAt: now });
  await tx.done;
  return checked;
}
