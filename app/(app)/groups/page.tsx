import type { Metadata } from 'next';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Groups' };

/** A place the shell has, with nothing in it yet: task 7.1 builds it. */
export default function Page() {
  return (
    <PageContainer>
      <PageHeader title="Groups" description="Every group you are in, open and closed." />
      <EmptyState
        icon="layers"
        heading="Nothing to show yet"
        description="This arrives with a later task of the roadmap."
      />
    </PageContainer>
  );
}
