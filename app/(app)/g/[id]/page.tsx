import type { Metadata } from 'next';
import { GroupPage } from '@/src/screens/GroupPage';

export const metadata: Metadata = { title: 'Group' };

/** A group (DESIGN.md §15.5), read from the device. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GroupPage groupId={id} />;
}
