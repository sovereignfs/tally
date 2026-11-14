import type { Metadata } from 'next';
import { GroupSettings } from '@/src/screens/GroupSettings';

export const metadata: Metadata = { title: 'Group settings' };

/** A group's settings (DESIGN.md §7, §15.3): online operations on what the device holds. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GroupSettings groupId={id} />;
}
