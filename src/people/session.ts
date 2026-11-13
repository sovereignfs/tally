import { requireSession, type Session } from '../auth/session';
import { getDatabase } from '../db/boot';
import { ensurePerson, type Person } from './persons';

/**
 * For a page or action that is only for someone signed in, and needs who they are in Tally: the session and **the account's person**, made here if
 * it is missing (`ensurePerson`). Names are read from the person, never from the auth store (AGENTS.md).
 */
export async function requirePerson(): Promise<{ session: Session; person: Person }> {
  const session = await requireSession();
  const person = await ensurePerson(await getDatabase(), {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  });
  return { session, person };
}
