import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RecordScreen } from '@/src/screens/RecordScreen';

export const metadata: Metadata = { title: 'Expense' };

/** An expense (DESIGN.md §15.6), read from the device. */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; expense: string }>;
}) {
  const { id, expense } = await params;
  return (
    <Suspense fallback={null}>
      <RecordScreen groupId={id} kind="expense" id={expense} />
    </Suspense>
  );
}
