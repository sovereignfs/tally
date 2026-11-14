import type { Metadata } from 'next';
import { Home } from '@/src/screens/Home';

export const metadata: Metadata = { title: 'Home' };

/** Home (DESIGN.md §15.4), read from the device. */
export default function Page() {
  return <Home />;
}
