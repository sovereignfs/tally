import type { Metadata } from 'next';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Activity' };

/** A place the shell has, with nothing in it yet: task 7.10 builds it. */
export default function Page() {
  return (
    <PageContainer>
      <PageHeader title="Activity" description="What happened in your groups." />
      <EmptyState
        icon="activity"
        heading="Nothing to show yet"
        description="This arrives with a later task of the roadmap."
      />
    </PageContainer>
  );
}
