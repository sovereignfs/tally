import type { Metadata } from 'next';
import { OfflineShell } from '@/src/ui/OfflineShell';

export const metadata: Metadata = { title: 'Tally', robots: { index: false, follow: false } };

/**
 * The one page the service worker keeps (DESIGN.md §15.11), answered for a signed-in address when there is no network. **It holds nothing of a person**
 * and asks nothing of the session: it is the same for everyone. Who is signed in is found on the device, in the browser (`OfflineShell`, task 6.4).
 */
export default function ShellPage() {
  return <OfflineShell />;
}
