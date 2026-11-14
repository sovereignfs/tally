import { describe, expect, it } from 'vitest';
import type { SyncClient, SyncOutcome } from './client';
import { type LoopEnvironment, startSyncLoop } from './loop';

/**
 * When a device syncs (DESIGN.md §11.3), with every timer, lock and event given: once after a burst of writes, on load, focus and coming online, every
 * 30 seconds only while visible, one tab at a time, backing off when offline, and stopping when the session has ended.
 */
function environment() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const listeners = new Map<string, Set<() => void>>();
  let held = false;
  let visible = true;
  const env: LoopEnvironment & {
    advance(ms: number): Promise<void>;
    fire(type: 'online' | 'focus' | 'visible'): void;
    setVisible(v: boolean): void;
    holdLock(v: boolean): void;
  } = {
    setTimeout(fn, ms) {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    locks: {
      async request(_name, _options, callback) {
        if (held) return callback(null);
        held = true;
        try {
          return await callback({});
        } finally {
          held = false;
        }
      },
    },
    random: () => 0.5,
    visible: () => visible,
    events: {
      listen(type, listener) {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
        return () => set.delete(listener);
      },
    },
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
        await flush();
      }
      now = until;
      await flush();
    },
    fire(type) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    setVisible(v) {
      visible = v;
    },
    holdLock(v) {
      held = v;
    },
  };
  return env;
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function fakeClient(outcome: () => SyncOutcome = () => ({ status: 'synced' })) {
  const writes = new Set<() => void>();
  let calls = 0;
  const client = {
    sync: async () => {
      calls++;
      return outcome();
    },
    onWrite: (listener: () => void) => {
      writes.add(listener);
      return () => writes.delete(listener);
    },
  } as unknown as SyncClient;
  return {
    client,
    write: () => {
      for (const listener of writes) listener();
    },
    calls: () => calls,
  };
}

describe('the sync loop', () => {
  it('syncs on load, once after a burst of writes, and on focus and coming online', async () => {
    const env = environment();
    const c = fakeClient();
    const loop = startSyncLoop({ client: c.client, lockName: 'l', environment: env });
    await flush();
    expect(c.calls()).toBe(1);
    for (let i = 0; i < 5; i++) c.write();
    await env.advance(1_000);
    expect(c.calls()).toBe(2);
    env.fire('focus');
    await flush();
    env.fire('online');
    await flush();
    expect(c.calls()).toBe(4);
    loop.stop();
  });

  it('syncs every 30 seconds while the page is visible, and not while it is hidden', async () => {
    const env = environment();
    const c = fakeClient();
    const loop = startSyncLoop({ client: c.client, lockName: 'l', environment: env });
    await flush();
    await env.advance(60_000);
    expect(c.calls()).toBe(3);
    env.setVisible(false);
    await env.advance(120_000);
    expect(c.calls()).toBe(3);
    loop.stop();
  });

  it('leaves syncing to the tab that holds the lock', async () => {
    const env = environment();
    env.holdLock(true);
    const c = fakeClient();
    const loop = startSyncLoop({ client: c.client, lockName: 'l', environment: env });
    await flush();
    c.write();
    await env.advance(1_000);
    expect(c.calls()).toBe(0);
    env.holdLock(false);
    c.write();
    await env.advance(1_000);
    expect(c.calls()).toBe(1);
    loop.stop();
  });

  it('backs off quietly while offline, and stops when the session has ended', async () => {
    const env = environment();
    let status: SyncOutcome = { status: 'offline' };
    const c = fakeClient(() => status);
    let signedOut = 0;
    const loop = startSyncLoop({
      client: c.client,
      lockName: 'l',
      environment: env,
      intervalMs: 10_000_000,
      onSignedOut: () => signedOut++,
    });
    await flush();
    expect(c.calls()).toBe(1);
    // The pauses grow: 2s, 4s, 8s…
    await env.advance(2_000);
    expect(c.calls()).toBe(2);
    await env.advance(3_000);
    expect(c.calls()).toBe(2);
    await env.advance(1_000);
    expect(c.calls()).toBe(3);
    status = { status: 'signed-out' };
    await env.advance(8_000);
    expect(signedOut).toBe(1);
    const after = c.calls();
    c.write();
    await env.advance(60_000);
    expect(c.calls()).toBe(after);
    loop.stop();
  });
});
