import type { Metadata } from 'next';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Home' };

/** A place the shell has, with nothing in it yet: task 7.7 builds it. */
export default function Page() {
  return (
    <PageContainer>
      <PageHeader title="Home" description="Where you stand, and what to do about it." />
      <EmptyState
        icon="house"
        heading="Nothing to show yet"
        description="This arrives with a later task of the roadmap."
      />
    </PageContainer>
  );
}
