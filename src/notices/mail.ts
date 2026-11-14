import { getConfig } from '../config/current';

/**
 * **Whether notices go by email from this server** (DESIGN.md §12.3): only with Tally's mail set up (`TALLY_SMTP_*`) and the app's address known, to
 * make the links from. With neither, the bell is the only channel, Settings says so, and nothing fails for it.
 *
 * Tests decide it with `setNoticeMailForTests`, since they never read the app's own settings.
 */
export interface NoticeMail {
  origin: string;
}

let decided: { value: NoticeMail | undefined } | undefined;

export function noticeMail(): NoticeMail | undefined {
  if (decided) return decided.value;
  try {
    const config = getConfig();
    return config.mail && config.url ? { origin: config.url } : undefined;
  } catch {
    return undefined;
  }
}

/** For a test: mail on from `origin`, or off (`undefined`); `null` goes back to the settings. */
export function setNoticeMailForTests(value: NoticeMail | undefined | null): void {
  decided = value === null ? undefined : { value };
}
