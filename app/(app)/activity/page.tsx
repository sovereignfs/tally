import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ActivityPage } from '@/src/screens/ActivityView';

export const metadata: Metadata = { title: 'Activity' };

/** Every group's activity (DESIGN.md §15.8), read online and said in words on the device. */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ActivityPage />
    </Suspense>
  );
}
