import type { Metadata } from 'next';
import { PeopleList } from '@/src/screens/People';

export const metadata: Metadata = { title: 'People' };

/** Everyone the person shares a group with (DESIGN.md §15.3), read from the device. */
export default function Page() {
  return <PeopleList />;
}
