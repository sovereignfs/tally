'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMe, useStoreChanges } from '../sync/react';
import type { NoticeRow } from './kinds';
import { rememberUnread, rememberedUnread } from './unread';

/**
 * **What the reader is told, on the device** (DESIGN.md §12.2): `GET /api/notices` when a page opens, when the window comes back into view, every
 * minute while it is in view, and after each sync; and the reader's reading of it, sent at once and shown at once. The bell and `/notifications`
 * each hold one, and tell each other when the reader reads, so that both agree. Offline, the count is the last one kept (`unread.ts`).
 */
const CHANGED = 'tally:notices';
const EVERY_MS = 60_000;

type Action = 'read' | 'dismiss' | 'read_all' | 'clear_all';

export function useNotices(limit: number) {
  const me = useMe();
  const changes = useStoreChanges();
  const accountId = me?.accountId ?? '';
  const [notices, setNotices] = useState<NoticeRow[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (accountId) setUnread((now) => now || rememberedUnread(accountId));
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    let live = true;
    void fetch(`/api/notices?limit=${limit}`, { cache: 'no-store' })
      .then(async (reply) =>
        reply.ok
          ? ((await reply.json()) as { notices: NoticeRow[]; unread: number; next: string | null })
          : null,
      )
      .catch(() => null)
      .then((answer) => {
        if (!live) return;
        if (!answer) return setOffline(true);
        setOffline(false);
        setNotices(answer.notices);
        setUnread(answer.unread);
        setNext(answer.next);
        rememberUnread(accountId, answer.unread);
      });
    return () => {
      live = false;
    };
  }, [accountId, limit, changes, tick]);

  // Again when the window is back in view, each minute while it is, and when the other holder reads.
  useEffect(() => {
    const again = () => setTick((n) => n + 1);
    const visible = () => document.visibilityState === 'visible' && again();
    const timer = setInterval(() => document.visibilityState === 'visible' && again(), EVERY_MS);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener(CHANGED, again);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener(CHANGED, again);
    };
  }, []);

  const act = useCallback(
    async (action: Action, ids: string[] = []) => {
      // Shown at once; the server's answer follows.
      setNotices((list) => {
        if (!list) return list;
        if (action === 'clear_all') return [];
        if (action === 'dismiss') return list.filter((n) => !ids.includes(n.id));
        return list.map((n) =>
          action === 'read_all' || ids.includes(n.id) ? { ...n, read: true } : n,
        );
      });
      setUnread((count) => {
        const value =
          action === 'read_all' || action === 'clear_all'
            ? 0
            : Math.max(
                0,
                count - (notices ?? []).filter((n) => !n.read && ids.includes(n.id)).length,
              );
        if (accountId) rememberUnread(accountId, value);
        return value;
      });
      await fetch('/api/notices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ids }),
      }).catch(() => undefined);
      window.dispatchEvent(new Event(CHANGED));
    },
    [accountId, notices],
  );

  const more = useCallback(async () => {
    if (!next) return;
    const reply = await fetch(`/api/notices?limit=${limit}&before=${encodeURIComponent(next)}`, {
      cache: 'no-store',
    }).catch(() => null);
    if (!reply?.ok) return;
    const answer = (await reply.json()) as { notices: NoticeRow[]; next: string | null };
    setNotices((list) => [...(list ?? []), ...answer.notices]);
    setNext(answer.next);
  }, [limit, next]);

  return {
    notices,
    unread,
    offline,
    hasMore: next !== null,
    more,
    read: (ids: string[]) => act('read', ids),
    dismiss: (ids: string[]) => act('dismiss', ids),
    readAll: () => act('read_all'),
    clearAll: () => act('clear_all'),
  };
}
