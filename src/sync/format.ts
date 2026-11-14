import type { Refusal } from '../actions/validate';
import type { Category } from '../actions/categories';
import type { SplitMethod } from '../money/split';

/**
 * **What a device and the server say to each other at `POST /api/sync`** (DESIGN.md §11.3): one definition, imported by the browser and the server.
 * The shape is Tusk's (`src/sync/format.ts`), changed where a group is written by several people: **the order is a counter per group** (`grp.seq`),
 * so a device keeps a cursor per group, and a pull answers per group.
 *
 * A request carries the outbox, in order, the cursor of every group the device holds, and the wraps of group keys it was asked to make (§5.3). An
 * answer carries what became of each mutation, the account's groups with what changed in each past its cursor (paged at `seq` boundaries), the groups
 * it is no longer in, and the keys: the wraps it lacks, the members it should wrap for, and the groups it should give a new epoch.
 */

/** Bumped when a device and the server stop understanding each other: a device too old is told to update (426), and keeps its outbox. */
export const PROTOCOL_VERSION = 1;

export const LIMITS = {
  /** Mutations in one request; a device with more sends them over several. */
  mutationsPerRequest: 50,
  /** Rows answered per request, across a request's groups, before the rest waits for the next (`more`). */
  rowsPerRequest: 1_000,
  /** Grants in one request. */
  grantsPerRequest: 200,
  /** The body, in bytes. */
  bodyBytes: 1024 * 1024,
} as const;

export interface SyncRequest {
  protocol: number;
  mutations: unknown[];
  /** Per group the device holds, the `seq` it has pulled through; a group new to the device is absent, or 0, which is its snapshot. */
  cursors: Record<string, number>;
  grants?: { groupId: string; epoch: number; accountId: string; wrapped: string }[];
}

export type MutationResult =
  | { mutationId: string; status: 'applied'; seq: number }
  | { mutationId: string | null; status: 'refused'; refusal: Refusal };

export interface SyncedGroup {
  id: string;
  sealed: string;
  color: string;
  defaultCurrency: string;
  simplifyDebts: boolean;
  closedAt: number | null;
  keyEpoch: number;
  seq: number;
}

/** A member as the device keeps it: names only (§11.1), never an email. */
export interface SyncedMember {
  id: string;
  personId: string;
  name: string;
  role: 'owner' | 'member' | null;
  placeholder: boolean;
  leftTally: boolean;
  joinedAt: number;
  leftAt: number | null;
  seq: number;
}

export interface SyncedExpense {
  id: string;
  sealed: string;
  amount: number;
  currency: string;
  date: string;
  category: Category;
  method: SplitMethod;
  payers: { memberId: string; amount: number }[];
  shares: { memberId: string; amount: number; units: number | null }[];
  version: number;
  createdBy: string;
  updatedBy: string;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  seq: number;
}

export interface SyncedPayment {
  id: string;
  sealed: string | null;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  currency: string;
  date: string;
  version: number;
  createdBy: string;
  updatedBy: string;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  seq: number;
}

export interface SyncedComment {
  id: string;
  subject: 'expense' | 'payment';
  subjectId: string;
  authorPersonId: string;
  sealed: string;
  deletedAt: number | null;
  createdAt: number;
  seq: number;
}

/** What changed in one group past the device's cursor. `cursor` is where the device now stands; `more` says a next request carries the rest. */
export interface GroupChanges {
  group: SyncedGroup;
  members: SyncedMember[];
  expenses: SyncedExpense[];
  payments: SyncedPayment[];
  comments: SyncedComment[];
  /** Rows removed for good (pruning, §11.8): the device deletes its copy. */
  tombstones: { table: string; id: string }[];
  cursor: number;
  more: boolean;
}

export interface SyncResponse {
  protocol: number;
  results: MutationResult[];
  /** Every group the account is in; one with nothing new past its cursor has empty lists. */
  groups: GroupChanges[];
  /** Groups the device named that the account is no longer in, or that are gone: the device deletes its copy. */
  gone: string[];
  keys: {
    wraps: { groupId: string; epoch: number; wrapped: string }[];
    needed: { groupId: string; epoch: number; accountId: string; publicKey: string }[];
    rotations: {
      groupId: string;
      epoch: number;
      members: { accountId: string; publicKey: string }[];
    }[];
    granted: { accepted: number; refused: number };
  };
}
