# Changelog

All notable changes to Tally are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

Each version's section is also its GitHub release notes. It is written in the change that sets the version, dated that day, and a promotion
titled `Release vX.Y.Z` is refused without it (RELEASING.md).

## [0.1.0] - 2026-11-15

The first release of Tally: shared expenses for groups, on its own or on a Sovereign instance.

### Added

- **Groups** in any currency, made by anyone signed in, with a colour and a name; owners rename them, change their currency and simplify debts, make and
  unmake owners, remove people, merge someone who is in a group twice, and close, reopen and delete a group. Anyone leaves once settled up; leaving,
  removing and closing are refused while someone owes, with the amounts said.
- **People** added by name, by an exact email, or from those you already share a group with; someone with no account is "not on Tally yet", with an
  invitation link to take their place (emailed where mail is set up, at most once an hour), which keeps everything they shared.
- **Expenses** split equally, by amounts, by percentages or by shares, paid by one person or several, with a category, a note and comments, added from
  anywhere (N) and by keyboard alone. Every change is kept in an expense's history, and an edit that crossed another is kept so that it can be restored.
- **Balances** per currency, never converted, pairwise or with debts simplified; **payments** to settle up, suggested or by hand, with a person across
  every group in one go; **Home** says where you stand and what to do about it; a person's page shows what you share.
- **Working offline:** groups live on the device, what you record is there at once and sent in the background; a change the server refuses waits in
  Couldn't sync with its reason, to send again, move to another group or let go. The app installs as a PWA, and on a phone it is a first-class way to use
  Tally.
- **Sealed in the browser:** a group's name, descriptions, notes and comments are sealed with the group's key before they leave the device, and the server
  never holds a key that opens them. A new device unlocks with the password or passkey that signs it in, or by another of your devices; a recovery key is
  offered once, and a copied invitation link opens the group at once.
- **Notices** in a bell and on a page of their own, for what concerns you, by each group's choice (everything, only what involves you, or nothing), and by
  email for the kinds you choose. A **reminder** to someone who owes you, once a day.
- **Insights:** what you spent, as your share of each expense, by category, by month and by group, and a group's spending by member, each chart with a
  table of the same figures.
- **Your data:** download everything as one file (made in the browser, so it is plain text), import a file as new groups you own, and delete your account,
  which keeps your name only where others still see it.
- **Sign-in** with a password (which never leaves the browser: it is derived there), passkeys and an authenticator app; or through a Sovereign instance,
  whose people are let in whatever the local sign-up setting says, with its bell, email, activity page and directory for people linked to it, and its
  notices to sign a person out or delete them. Sign-up is by invitation by default.
- **Running it:** one image, with an sqld service, a SQLite file or PostgreSQL, checked at start-up and migrated as it starts; mail in the background
  from an outbox; every setting in `.env.example` and the README; `pnpm seed` for development.
- A security review of phase 1, `docs/security-review.md`, with nothing of high severity open.

[0.1.0]: https://github.com/sovereignfs/tally/releases/tag/v0.1.0
