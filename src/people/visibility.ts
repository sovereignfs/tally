import type { Person } from './persons';

/**
 * **Who may see a person's email** (DESIGN.md §6.1), one function used by every read that returns a person: the person themselves; the owners of a
 * group they are in; and, for a placeholder, whoever added it. Never other members, and never in a notice, an activity line or another person's
 * export, which do not call this and carry no email at all.
 *
 * What the reader is to the person (an owner of a group they share) is decided by the read, in its SQL, and given here; this decides only what it
 * means for the email.
 */
export interface Viewer {
  accountId: string;
  personId: string;
}

export interface Relation {
  /** The viewer is an owner of a group the person is an active member of. */
  ownsAGroupTheyAreIn?: boolean;
}

export function emailVisible(
  viewer: Viewer,
  person: Pick<Person, 'id' | 'accountId' | 'addedBy'>,
  relation: Relation = {},
): boolean {
  if (person.id === viewer.personId) return true;
  if (person.accountId !== null && person.accountId === viewer.accountId) return true;
  if (person.accountId === null && person.addedBy === viewer.personId) return true;
  return relation.ownsAGroupTheyAreIn === true;
}

/** A person as a reader may see them: the name always, the email only where `emailVisible` says so, and nothing else of the record. */
export interface PersonView {
  id: string;
  name: string;
  email: string | null;
  placeholder: boolean;
  /** Their account was deleted: shown as "Sam (left Tally)" (§18). */
  leftTally: boolean;
}

export function viewPerson(
  viewer: Viewer,
  person: Pick<Person, 'id' | 'accountId' | 'addedBy' | 'name' | 'email' | 'deletedAt'>,
  relation: Relation = {},
): PersonView {
  return {
    id: person.id,
    name: person.name,
    email: emailVisible(viewer, person, relation) ? person.email : null,
    placeholder: person.accountId === null && person.deletedAt === null,
    leftTally: person.deletedAt !== null,
  };
}
