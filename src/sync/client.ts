import type { LocalDatabase } from '../local/db';
import {
  type Reseal,
  type Settled,
  checkLocally,
  discardFailed,
  moveFailed,
  resendFailed,
  commitMutation,
  readCursors,
  readOutbox,
  settle,
} from '../local/store';
import { LIMITS, PROTOCOL_VERSION, type SyncRequest, type SyncResponse } from './format';

/**
 * **A device's side of sync for one account** (DESIGN.md §11): **commit** a mutation to the device's store and outbox, **sync** the outbox to the server
 * and take what it answers, and tell whoever listens that something changed. Tusk's `SyncClient`, with a cursor per group and the key exchange folded
 * in. Made of a database, a transport and a clock, all given, so a test makes devices of them with no real network.
 *
 * Nothing here is awaited by a screen but `commit`, which ends when the store has the change: recording never waits for the network.
 */
export type SyncOutcome =
  | { status: 'synced' }
  | { status: 'offline' }
  | { status: 'signed-out' }
  | { status: 'update-required' }
  | { status: 'rate-limited'; retryAfterMs: number }
  | { status: 'error' };

/** How a request reaches the server: `fetch` in the browser, the route itself in a test. */
export type Transport = (
  request: SyncRequest,
) => Promise<
  | { kind: 'answer'; answer: SyncResponse }
  | { kind: 'status'; status: number; retryAfterMs?: number }
  | { kind: 'offline' }
>;

/** The key exchange of a sync's answer (`GroupKeys.exchange`): wraps it opened, and the grants it made, which the next request carries. */
export interface KeyExchange {
  exchange(keys: SyncResponse['keys']): Promise<{ grants: NonNullable<SyncRequest['grants']> }>;
}

export interface SyncClientOptions {
  db: LocalDatabase;
  transport: Transport;
  /** The device's person, who a change it makes is by. */
  personId: string;
  keys?: KeyExchange;
  now?: () => number;
  /** Other tabs of the same account: told of every change, and telling of theirs. */
  channel?: Pick<
    BroadcastChannel,
    'postMessage' | 'addEventListener' | 'removeEventListener' | 'close'
  >;
  /** The most rounds of one sync: a device with a long way to catch up goes on at the next trigger. */
  maxRounds?: number;
}

export class SyncClient {
  private readonly listeners = new Set<() => void>();
  private readonly writeListeners = new Set<() => void>();
  private readonly refusalListeners = new Set<(settled: Settled['refused']) => void>();
  private readonly now: () => number;
  private grants: NonNullable<SyncRequest['grants']> = [];
  private readonly onChannel = (event: Event) => {
    this.emit();
    if ((event as MessageEvent).data?.type === 'write') for (const l of this.writeListeners) l();
  };

  constructor(private readonly options: SyncClientOptions) {
    this.now = options.now ?? Date.now;
    options.channel?.addEventListener('message', this.onChannel);
  }

  get db(): LocalDatabase {
    return this.options.db;
  }

  /** Checks a mutation as the server will, applies it to the store and queues it, as one write. Throws a `LocalRefusal` for one the server would refuse. */
  async commit(raw: unknown): Promise<void> {
    const mutation = await checkLocally(this.options.db, raw);
    await commitMutation(this.options.db, mutation, this.options.personId, this.now());
    this.announce('write');
  }

  /** Couldn't sync (§11.5): sends a refused change again, as it was. */
  async resend(mutationId: string): Promise<void> {
    await resendFailed(this.options.db, mutationId, this.options.personId, this.now());
    this.announce('write');
  }

  /** Couldn't sync: records a refused expense or payment in another group instead. */
  async move(mutationId: string, targetGroupId: string, reseal: Reseal): Promise<void> {
    await moveFailed(
      this.options.db,
      mutationId,
      targetGroupId,
      reseal,
      { mutationId: crypto.randomUUID(), rowId: crypto.randomUUID() },
      this.options.personId,
      this.now(),
    );
    this.announce('write');
  }

  /** Couldn't sync: lets a refused change go, as the person chose. */
  async discard(mutationId: string): Promise<void> {
    await discardFailed(this.options.db, mutationId);
    this.announce('pull');
  }

  /** One sync: rounds of outbox and pull until nothing is waiting on either side, or `maxRounds`. */
  async sync(): Promise<SyncOutcome> {
    const rounds = this.options.maxRounds ?? 10;
    for (let round = 0; round < rounds; round++) {
      const sent = await readOutbox(this.options.db, LIMITS.mutationsPerRequest);
      const grants = this.grants;
      const request: SyncRequest = {
        protocol: PROTOCOL_VERSION,
        mutations: sent.map((entry) => entry.mutation),
        cursors: await readCursors(this.options.db),
        ...(grants.length > 0 ? { grants } : {}),
      };
      let reply: Awaited<ReturnType<Transport>>;
      try {
        reply = await this.options.transport(request);
      } catch {
        return { status: 'error' };
      }
      if (reply.kind === 'offline') return { status: 'offline' };
      if (reply.kind === 'status') {
        if (reply.status === 401) return { status: 'signed-out' };
        if (reply.status === 426) return { status: 'update-required' };
        if (reply.status === 429)
          return { status: 'rate-limited', retryAfterMs: reply.retryAfterMs ?? 30_000 };
        return { status: 'error' };
      }
      this.grants = [];
      const settled = await settle(
        this.options.db,
        sent,
        reply.answer,
        this.options.personId,
        this.now(),
      );
      if (this.options.keys) {
        try {
          this.grants = (await this.options.keys.exchange(reply.answer.keys)).grants;
        } catch {
          // The key exchange is tried again at the next sync; nothing recorded depends on it.
        }
      }
      if (settled.refused.length > 0)
        for (const listener of this.refusalListeners) listener(settled.refused);
      this.announce('pull');
      const waiting = (await readOutbox(this.options.db, 1)).length > 0;
      if (!settled.more && !waiting && this.grants.length === 0) return { status: 'synced' };
    }
    return { status: 'synced' };
  }

  /** Told when the store changed, here or in another tab. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Told when something was written that the loop should send. */
  onWrite(listener: () => void): () => void {
    this.writeListeners.add(listener);
    return () => this.writeListeners.delete(listener);
  }

  /** Told of mutations the server refused (Couldn't sync, a refused comment's toast). */
  onRefused(listener: (refused: Settled['refused']) => void): () => void {
    this.refusalListeners.add(listener);
    return () => this.refusalListeners.delete(listener);
  }

  close(): void {
    this.options.channel?.removeEventListener('message', this.onChannel);
    this.options.channel?.close();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private announce(type: 'write' | 'pull') {
    this.emit();
    if (type === 'write') for (const listener of this.writeListeners) listener();
    this.options.channel?.postMessage({ type });
  }
}

/** The browser's transport: the app's route, with this page's cookies and Origin. Offline is a failed fetch. */
export const fetchTransport: Transport = async (request) => {
  let reply: Response;
  try {
    reply = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    });
  } catch {
    return { kind: 'offline' };
  }
  if (reply.status !== 200) {
    const after = Number(reply.headers.get('retry-after'));
    return {
      kind: 'status',
      status: reply.status,
      ...(Number.isFinite(after) && after > 0 ? { retryAfterMs: after * 1000 } : {}),
    };
  }
  return { kind: 'answer', answer: (await reply.json()) as SyncResponse };
};
