import type { Message } from './mailer';

/**
 * The messages the app sends (DESIGN.md §6), plain text, each with one link and nothing of the account but the address it goes to. What the link does is the
 * sign-in library's: a verification link signs the person in, and a reset link is good once.
 */
export function verificationMessage(app: string, to: string, link: string): Message {
  return {
    to,
    subject: `Confirm your address for ${app}`,
    text: `Confirm this address for ${app} and sign in:\n\n${link}\n\nIf you did not ask for this, ignore it: nothing happens until the link is used.\n`,
  };
}

export function resetMessage(app: string, to: string, link: string): Message {
  return {
    to,
    subject: `Reset your ${app} password`,
    text: `Choose a new password for ${app}:\n\n${link}\n\nThe link can be used once and ends soon. Using it signs you out everywhere else. If you did not ask for this, ignore it: your password is not changed.\n`,
  };
}

/** What a notice's email is made from (DESIGN.md §12.3): who, a figure and links, never sealed text, so never a group's name or a description. */
export interface NoticeMailData {
  kind: string;
  /** The activity line's kind, which says changed, deleted or restored. */
  lineKind: string;
  actorName: string;
  amount: number | null;
  currency: string | null;
  link: string;
  settingsLink: string;
  /** For core's bell to someone not on Tally yet, found in core's directory: whom it is for (§6.2). */
  sub?: string;
}

/** The sentence of a notice's email, or nothing for a kind this version does not know. */
export function noticeSentence(
  app: string,
  d: NoticeMailData,
  money: string | null,
): string | undefined {
  const of = money ? ` of ${money}` : '';
  const verb = d.lineKind.endsWith('_deleted')
    ? 'deleted'
    : d.lineKind.endsWith('_restored')
      ? 'restored'
      : 'changed';
  switch (d.kind) {
    case 'expense_added':
      return `${d.actorName} added an expense${of} in a group on ${app}`;
    case 'expense_changed':
      return `${d.actorName} ${verb} an expense${of} in a group on ${app}`;
    case 'payment_recorded':
      return d.lineKind === 'payment_added'
        ? `${d.actorName} recorded a payment${of} in a group on ${app}`
        : `${d.actorName} ${verb} a payment${of} in a group on ${app}`;
    case 'comment':
      return `${d.actorName} commented in a group on ${app}`;
    case 'group_closed':
      return `${d.actorName} ${d.lineKind === 'group_reopened' ? 'reopened' : 'closed'} a group on ${app}`;
    case 'added_to_group':
      return `${d.actorName} added you to a group on ${app}`;
    case 'invite_accepted':
      return `${d.actorName} took your invitation and joined a group on ${app}`;
    case 'edit_replaced':
      return `${d.actorName} changed ${d.lineKind.startsWith('payment_') ? 'a payment' : 'an expense'} in a group on ${app}, in place of your change`;
    case 'owner_passed':
      return `You are now an owner of a group on ${app}: its last owner left`;
    case 'reminder':
      return money
        ? `${d.actorName} reminded you that you owe ${money} in a group on ${app}`
        : `${d.actorName} reminded you of what you owe in a group on ${app}`;
    default:
      return undefined;
  }
}

/** A notice by email: one sentence, a link to it, and a link to Settings to turn the kind's email off. */
export function noticeMessage(
  app: string,
  to: string,
  sentence: string,
  d: NoticeMailData,
): Message {
  return {
    to,
    subject: sentence,
    text: `${sentence}.\n\nSee it on ${app}:\n\n${d.link}\n\nWhat it is about stays private to the group, so it is not in this email. To choose what you are emailed about: ${d.settingsLink}\n`,
  };
}

/**
 * An invitation (DESIGN.md §6.3): who invited, and the link. **Never the group's name,** which is sealed and which the server cannot read (§5.3); the
 * page the link opens says more once it is open. The link is the invitation: whoever holds it can take the place.
 */
export function invitationMessage(
  app: string,
  to: string,
  inviterName: string,
  link: string,
  reminder?: string,
): Message {
  // A reminder (§12.4) to someone not on Tally yet is their invitation, with what they owe said first.
  if (reminder)
    return {
      to,
      subject: `${inviterName} reminded you that you owe ${reminder} on ${app}`,
      text: `${inviterName} reminded you that you owe ${reminder}, in a group on ${app} where you share expenses.\n\nSee what for, and take your place:\n\n${link}\n\nThe link works once, for 14 days. If you were not expecting this, ignore it.\n`,
    };
  return {
    to,
    subject: `${inviterName} added you to a group on ${app}`,
    text: `${inviterName} added you to a group on ${app}, to share expenses.\n\nSee it, and take your place:\n\n${link}\n\nThe link works once, for 14 days. If you were not expecting this, ignore it.\n`,
  };
}
