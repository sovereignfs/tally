'use client';

import { useEffect } from 'react';
import { type Identity, rememberIdentity } from '../identity';

/** Keeps who is signed in on the device (`src/identity.ts`), so that the offline shell can open their groups (DESIGN.md §15.11). Drawn by every signed-in page. */
export function RememberIdentity(identity: Identity) {
  const { id, personId, name, email } = identity;
  useEffect(() => rememberIdentity({ id, personId, name, email }), [id, personId, name, email]);
  return null;
}
