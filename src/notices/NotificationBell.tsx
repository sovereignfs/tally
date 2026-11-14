'use client';

import { usePathname, useRouter } from 'next/navigation';
import { type MouseEvent, useEffect, useState } from 'react';
import { Icon, NotificationsPanel } from '@sovereignfs/ui';
import { useNotices } from './client';
import type { NoticeKind } from './kinds';
import { useNoticeWords } from './useWords';
import { ago, noticeHref } from './words';

/**
 * **The bell,** left of the avatar (DESIGN.md §12.2), as Tusk's (`src/screens/NotificationBell.tsx`, copied and changed to Tally's kinds and words):
 * the design system's `NotificationsPanel` over the latest notices, the unread count on it up to "99+", each with an icon for its kind, its words, how
 * long ago and a dot while unread. **Opening a notice reads it** and goes where it points; each can be dismissed; "Mark all read", "Clear all" and
 * "View all" (`/notifications`). Offline it shows the count last synced.
 *
 * The panel's links would load the page again: a click on one is made a navigation of the app here, and the panel is made again for the new place, so
 * that it closes.
 */
export const BELL_LIMIT = 20;

const ICONS: Record<
  NoticeKind,
  | 'user-round-plus'
  | 'message-square'
  | 'users'
  | 'credit-card'
  | 'archive'
  | 'clock'
  | 'file-text'
  | 'shield'
  | 'arrow-left-right'
> = {
  added_to_group: 'user-round-plus',
  expense_added: 'file-text',
  expense_changed: 'file-text',
  payment_recorded: 'arrow-left-right',
  comment: 'message-square',
  group_closed: 'archive',
  reminder: 'clock',
  invite_accepted: 'users',
  edit_replaced: 'file-text',
  owner_passed: 'shield',
};

export function NotificationBell() {
  const { notices, unread, read, dismiss, readAll, clearAll } = useNotices(BELL_LIMIT);
  const words = useNoticeWords(notices);
  const router = useRouter();
  const pathname = usePathname();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const items = (notices ?? []).map((notice) => ({
    id: notice.id,
    icon: <Icon name={ICONS[notice.kind]} size="md" aria-hidden />,
    title: words(notice),
    timeLabel: ago(notice.createdAt, now),
    read: notice.read,
    href: noticeHref(notice),
    onOpen: () => void read([notice.id]),
    onDismiss: () => void dismiss([notice.id]),
  }));

  return (
    // A capture, so that it comes before the link's own handler, which still runs (it reads the notice).
    <div
      onClickCapture={(event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = (event.target as Element).closest?.('a[href]');
        const href = link?.getAttribute('href');
        if (!href || !href.startsWith('/') || href.startsWith('//')) return;
        event.preventDefault();
        router.push(href);
      }}
    >
      <NotificationsPanel
        key={pathname}
        items={items}
        unreadCount={unread}
        onMarkAllRead={() => void readAll()}
        onClearAll={() => void clearAll()}
        emptyMessage="Nothing new."
        viewAllHref="/notifications"
        align="right"
      />
    </div>
  );
}
