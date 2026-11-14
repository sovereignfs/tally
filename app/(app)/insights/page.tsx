import type { Metadata } from 'next';
import { InsightsPage } from '@/src/screens/InsightsView';

export const metadata: Metadata = { title: 'Insights' };

/** What the reader spent (DESIGN.md §13), from the device's rows. */
export default function Page() {
  return <InsightsPage />;
}
