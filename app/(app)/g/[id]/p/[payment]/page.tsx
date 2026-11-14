import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RecordScreen } from '@/src/screens/RecordScreen';

export const metadata: Metadata = { title: 'Payment' };

/** A payment (DESIGN.md §15.6), read from the device. */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; payment: string }>;
}) {
  const { id, payment } = await params;
  return (
    <Suspense fallback={null}>
      <RecordScreen groupId={id} kind="payment" id={payment} />
    </Suspense>
  );
}
