import type { Metadata } from 'next';
import { PersonScreen } from '@/src/screens/People';

export const metadata: Metadata = { title: 'Person' };

/** One person (DESIGN.md §15.7), read from the device. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PersonScreen personId={id} />;
}
