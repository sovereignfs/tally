/**
 * What the landing page says (DESIGN.md §1), as typed content so that it is read in one place and cannot be half-edited. It says what is so today and
 * nothing that is only planned: a page that promises what the app does not do is worse than a short one. Each task that builds something a visitor would
 * want to know about adds a line here, and `content.test.ts` keeps the words of what is not built out until it is. Copied from Ledger's, its words
 * Tally's.
 */
export interface Feature {
  title: string;
  body: string;
}

export const landing = {
  heading: 'Money shared between people, on a server of your own',
  lead: 'Tally is for a trip, a flat or a dinner club: who paid, who owes whom. It is being built, and runs on a server you chose.',
  signIn: 'Sign in',
  signUp: 'Create an account',
  noSignIn: 'Signing in is not set up on this server.',
  features: [
    {
      title: 'What you write is sealed',
      body: 'The names and words of your groups are sealed in your browser, so only their members can read them, and the server cannot.',
    },
    {
      title: 'Signing in',
      body: 'A password, a passkey or an authenticator app. The one you sign in with also unlocks a new device: no key to keep.',
    },
    {
      title: 'On a phone or a desktop',
      body: 'The same places at the same addresses at every width, in light or dark.',
    },
  ] satisfies Feature[],
} as const;
