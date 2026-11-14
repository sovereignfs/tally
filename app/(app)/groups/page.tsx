import type { Metadata } from 'next';
import { PageContainer, PageHeader } from '@sovereignfs/ui';
import { GroupsList } from '@/src/screens/GroupsList';

export const metadata: Metadata = { title: 'Groups' };

/** Every group the person is in (DESIGN.md §15.3), read from the device. */
export default function Page() {
  return (
    <PageContainer>
      <PageHeader title="Groups" description="Every group you are in, open and closed." />
      <GroupsList />
    </PageContainer>
  );
}
