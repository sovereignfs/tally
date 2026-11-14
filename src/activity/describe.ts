import type { ActivityLine, ExpenseDetails, PaymentDetails } from './kinds';

/**
 * **A line of activity in words, from the reader's point of view** (DESIGN.md §12.1): "You paid 9.60 for Tram tickets", "Sam paid you 63.20". One
 * pure function, run **on the device**, which opens the sealed text the line carries with the group's key and hands it in through `opened`; the server
 * never makes these sentences, and never reads the text in them.
 *
 * Where the text cannot be opened (the device is not yet unlocked for the group) the sentence says "an expense" or "the group" and leaves the rest out,
 * so a line is never blank and never wrong.
 */
export interface DescribeContext {
  /** The reader's person: they are "You". */
  readerPersonId: string;
  /** A member of the line's group, as their person (members are named by their person, whose name outlives the membership). */
  personOfMember: (memberId: string) => string | undefined;
  /** A person's name, as every member sees it. */
  nameOf: (personId: string) => string | undefined;
  /** A sealed value, opened with the group's key; `undefined` when it cannot be. */
  opened: (sealed: string) => Readonly<Record<string, string | null>> | undefined;
  /** An amount in its currency, formatted for the reader. */
  money: (amount: number, currency: string) => string;
}

export function describeActivity(line: ActivityLine, c: DescribeContext): string {
  const who = (personId: string | null | undefined) => ({
    subject: !personId
      ? 'Someone'
      : personId === c.readerPersonId
        ? 'You'
        : (c.nameOf(personId) ?? 'Someone'),
    object: !personId
      ? 'someone'
      : personId === c.readerPersonId
        ? 'you'
        : (c.nameOf(personId) ?? 'someone'),
    possessive: !personId
      ? 'someone’s'
      : personId === c.readerPersonId
        ? 'your'
        : `${c.nameOf(personId) ?? 'someone'}’s`,
  });
  const member = (memberId: string) => who(c.personOfMember(memberId));
  const actor = who(line.actorPersonId);
  const text = (sealed: string | null | undefined, field: string) => {
    if (!sealed) return undefined;
    const value = c.opened(sealed)?.[field];
    return value ? value : undefined;
  };
  const quote = (value: string) => `“${value}”`;

  const expense = (d: ExpenseDetails) => {
    const description = text(d.sealed, 'description');
    return description ?? 'an expense';
  };
  const payment = (d: PaymentDetails) =>
    `${member(d.fromMemberId).subject} paid ${member(d.toMemberId).object} ${c.money(d.amount, d.currency)}`;
  const lower = (sentence: string) =>
    sentence.startsWith('You ') ? `you ${sentence.slice(4)}` : sentence;

  switch (line.kind) {
    case 'expense_added': {
      const d = line.details;
      const amount = c.money(d.amount, d.currency);
      const description = text(d.sealed, 'description');
      const [only] = d.payers;
      if (d.payers.length === 1 && only && c.personOfMember(only.memberId) === line.actorPersonId)
        return description
          ? `${actor.subject} paid ${amount} for ${description}`
          : `${actor.subject} paid ${amount} for an expense`;
      const payers = d.payers.map((p) => member(p.memberId).object);
      return `${actor.subject} added ${expense(d)}, ${amount} paid by ${list(payers)}`;
    }
    case 'expense_edited':
      return `${actor.subject} changed ${expense(line.details)}`;
    case 'expense_deleted':
      return `${actor.subject} deleted ${expense(line.details)}`;
    case 'expense_restored':
      return `${actor.subject} restored ${expense(line.details)}`;
    case 'expense_replaced':
      return `${actor.subject} changed ${expense(line.details)}, in place of ${who(line.details.replacedPersonId).possessive} change`;
    case 'payment_added': {
      const d = line.details;
      const from = c.personOfMember(d.fromMemberId);
      return from === line.actorPersonId
        ? payment(d)
        : `${actor.subject} recorded that ${lower(payment(d))}`;
    }
    case 'payment_edited':
      return `${actor.subject} changed a payment: ${lower(payment(line.details))}`;
    case 'payment_deleted':
      return `${actor.subject} deleted a payment: ${lower(payment(line.details))}`;
    case 'payment_restored':
      return `${actor.subject} restored a payment: ${lower(payment(line.details))}`;
    case 'payment_replaced':
      return `${actor.subject} changed a payment, in place of ${who(line.details.replacedPersonId).possessive} change: ${lower(payment(line.details))}`;
    case 'comment_added': {
      const d = line.details;
      const on =
        d.subject === 'payment'
          ? 'a payment'
          : (() => {
              const description = text(d.subjectSealed, 'description');
              return description ?? 'an expense';
            })();
      const body = text(d.sealed, 'body');
      return body
        ? `${actor.subject} commented on ${on}: ${quote(body)}`
        : `${actor.subject} commented on ${on}`;
    }
    case 'group_created': {
      const name = text(line.details.sealed, 'name');
      return name ? `${actor.subject} made the group ${name}` : `${actor.subject} made the group`;
    }
    case 'group_renamed': {
      const name = text(line.details.sealed, 'name');
      return name
        ? `${actor.subject} renamed the group ${name}`
        : `${actor.subject} renamed the group`;
    }
    case 'group_currency_changed':
      return `${actor.subject} changed the group’s currency from ${line.details.from} to ${line.details.to}`;
    case 'group_simplify_changed':
      return `${actor.subject} turned ${line.details.on ? 'on' : 'off'} simplify debts`;
    case 'group_closed':
      return `${actor.subject} closed the group`;
    case 'group_reopened':
      return `${actor.subject} reopened the group`;
    case 'member_added':
      return `${actor.subject} added ${who(line.details.personId).object}`;
    case 'member_invited':
      return `${actor.subject} invited ${who(line.details.personId).object}`;
    case 'member_joined':
      return `${who(line.details.personId).subject} joined by invitation`;
    case 'member_left':
      return `${who(line.details.personId).subject} left the group`;
    case 'member_removed':
      return `${actor.subject} removed ${who(line.details.personId).object}`;
    case 'member_merged':
      return `${actor.subject} merged ${who(line.details.fromPersonId).object} into ${who(line.details.personId).object}`;
    case 'role_changed':
      return `${actor.subject} made ${who(line.details.personId).object} ${line.details.role === 'owner' ? 'an owner' : 'a member'}`;
  }
}

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? 'someone';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
