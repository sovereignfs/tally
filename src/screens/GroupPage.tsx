'use client';

import { Suspense } from 'react';
import { BalancesView } from './BalancesView';
import { GroupScreen } from './GroupScreen';

/** A group's page with every view its tasks have built so far (DESIGN.md §15.5). Shared by the route and the offline shell. */
export function GroupPage({ groupId }: { groupId: string }) {
  return (
    <Suspense fallback={null}>
      <GroupScreen groupId={groupId} views={{ balances: (view) => <BalancesView view={view} /> }} />
    </Suspense>
  );
}
