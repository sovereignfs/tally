'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Button, EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';
import { useNotices } from './client';
import { useNoticeWords } from './useWords';
import { groupByDay, noticeHref } from './words';
import styles from '../screens/Screens.module.css';

/**
 * **`/notifications`** (DESIGN.md §12.2): everything the reader is told, by day in their own zone, newest first; each opens where it points and reads
 * itself, can be marked read or dismissed; "Mark all read"; a page at a time. Read online; offline it says so.
 */
const PAGE = 50;

export function NotificationsPage() {
  const { notices, unread, offline, hasMore, more, read, dismiss, readAll } = useNotices(PAGE);
  const words = useNoticeWords(notices);
  const days = useMemo(
    () => groupByDay(notices ?? [], Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone),
    [notices],
  );

  return (
    <PageContainer>
      <PageHeader
        title="Notifications"
        description="What happened that concerns you."
        action={
          unread > 0 ? (
            <Button variant="secondary" onClick={() => void readAll()}>
              Mark all read
            </Button>
          ) : undefined
        }
      />
      {notices === null && offline ? (
        <p className={styles.muted}>Notifications need a connection.</p>
      ) : notices === null ? null : notices.length === 0 ? (
        <EmptyState icon="bell" heading="Nothing yet" description="What concerns you shows here." />
      ) : (
        days.map((day) => (
          <section key={day.date} aria-label={day.label}>
            <h2 className={styles.small}>{day.label}</h2>
            <ul className={styles.list} aria-label={`Notifications, ${day.label}`}>
              {day.notices.map((notice) => (
                <li key={notice.id} className={styles.line}>
                  <span className={styles.lineMain}>
                    <Link
                      href={noticeHref(notice)}
                      onClick={() => void read([notice.id])}
                      aria-label={`${words(notice)}${notice.read ? '' : ', unread'}`}
                    >
                      {notice.read ? words(notice) : <strong>{words(notice)}</strong>}
                    </Link>
                  </span>
                  <span className={styles.lineEnd}>
                    {notice.read ? null : (
                      <Button variant="ghost" size="sm" onClick={() => void read([notice.id])}>
                        Mark read
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Dismiss: ${words(notice)}`}
                      onClick={() => void dismiss([notice.id])}
                    >
                      Dismiss
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {hasMore ? (
        <div>
          <Button variant="secondary" onClick={() => void more()}>
            Show earlier
          </Button>
        </div>
      ) : null}
    </PageContainer>
  );
}
