import type { Metadata } from 'next';
import { EmptyState, PageContainer, PageHeader } from '@sovereignfs/ui';

export const metadata: Metadata = { title: 'Insights' };

/** A place the shell has, with nothing in it yet: task 10.2 builds it. */
export default function Page() {
  return (
    <PageContainer>
      <PageHeader title="Insights" description="What you spent, by category, month and group." />
      <EmptyState
        icon="layout-dashboard"
        heading="Nothing to show yet"
        description="This arrives with a later task of the roadmap."
      />
    </PageContainer>
  );
}
