import type { Metadata } from 'next';
import { NotificationsPage } from '@/src/notices/NotificationsPage';

export const metadata: Metadata = { title: 'Notifications' };

/** Everything the reader is told (DESIGN.md §12.2), by day, read online and said in words on the device. */
export default function Page() {
  return <NotificationsPage />;
}
