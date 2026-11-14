import { getConfig } from '../config/current';

/**
 * **How notices leave this server, beyond the bell** (DESIGN.md §12.3, §14.5): Tally's own mail (`TALLY_SMTP_*`), and, where people sign in through
 * a core, core's bell and core's email for those linked to it. Either needs the app's address, to make the links from. With neither, the bell is the
 * only channel, Settings says so, and nothing fails for it.
 *
 * Tests decide it with `setNoticeMailForTests`, since they never read the app's own settings.
 */
export interface NoticeMail {
  origin: string;
  /** Tally's own mail is set up. True when not said. */
  smtp?: boolean;
  /** A core is set up: its bell and its email, for people linked to it. False when not said. */
  core?: boolean;
}

export const smtpOn = (mail: NoticeMail | undefined): boolean =>
  mail !== undefined && mail.smtp !== false;
export const coreOn = (mail: NoticeMail | undefined): boolean =>
  mail !== undefined && mail.core === true;

let decided: { value: NoticeMail | undefined } | undefined;

export function noticeMail(): NoticeMail | undefined {
  if (decided) return decided.value;
  try {
    const config = getConfig();
    const smtp = config.mail !== undefined;
    const core = config.auth?.sovereign !== undefined;
    return config.url && (smtp || core) ? { origin: config.url, smtp, core } : undefined;
  } catch {
    return undefined;
  }
}

/** For a test: mail on from `origin` (its channels as given), or off (`undefined`); `null` goes back to the settings. */
export function setNoticeMailForTests(value: NoticeMail | undefined | null): void {
  decided = value === null ? undefined : { value };
}
