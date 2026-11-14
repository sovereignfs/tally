'use client';

import { useLocal, useMe } from '../sync/react';
import { type GroupView, readGroupViews } from './data';

/** Every group on the device, as the sidebar and `/groups` show them: open by latest activity, closed after. `undefined` until read. */
export function useGroupViews(): GroupView[] | undefined {
  const me = useMe();
  return useLocal((db) => readGroupViews(db, me?.personId ?? ''), [me?.personId]);
}
