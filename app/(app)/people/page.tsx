import type { Metadata } from 'next';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'People' };

/** A place the shell has, with nothing in it yet: task 7.8 builds it. */
export default function Page() {
  return (
    <PageContainer>
      <PageHeader title="People" description="Everyone you share a group with." />
      <EmptyState
        icon="users"
        heading="Nothing to show yet"
        description="This arrives with a later task of the roadmap."
      />
    </PageContainer>
  );
}
