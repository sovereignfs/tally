# Epics

A domain-first map of the work. An epic groups the tasks of one domain. [`ROADMAP.md`](../../ROADMAP.md) is the same tasks in the order they are
built, with their priority and status. [`DESIGN.md`](../../DESIGN.md) is what they build; where a task and the design disagree, the design wins and
the task is corrected.

## Conventions

- **Task IDs are permanent:** `<epic>.<n>`, for example `4.3`. Use them in dependency lists and cross-references. They never appear in branch names,
  commit messages or PR titles, and an ID is never reused, even for a task that was superseded.
- **One task, one branch, one draft PR.** A task is done when its "Accepts when" holds and its PR is merged.
- **Every task** has a Goal, a Design reference, what it Depends on, Technical detail, and Accepts when. Once done it gains **Done as**: how it was
  done, where, and what was left out.
- **On completion,** the task's heading here and its row in `ROADMAP.md` are marked ✅ in the same PR, and a change in behaviour adds a line to
  `CHANGELOG.md`.
- **Every task holds these without saying so:** a data-layer test passes on sqld, a `file:` database and PostgreSQL; a new route, operation or
  mutation is in `src/access/routes.ts` with a test calling it as a second person (once 3.2 is in); a new table is handled by `People.deletePerson`
  (once 2.5 is in) and by export and import (once 12.1 is in); a write goes through the one path and keeps the arithmetic's invariants (once 5.2 is
  in); a screen works with a keyboard, in light and dark, at a phone's width, and offline where `DESIGN.md` §11 says it does; no amount, description,
  note, comment, name or address reaches a log; a safeguard's test was seen to fail with it switched off.
- **Epic 14 is done in `sovereign`,** following that repository's conventions; its tasks here record what Tally needs and are marked done when the
  release that carries it is published.

_Status key: ✅ Done · ⏳ In progress · 📋 Planned · 🚧 Waits on a decision · ➖ Superseded_

## Epics

| #   | Epic                                    | What it holds                                                                                           | Tasks |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----- |
| 1   | [Foundation](foundation.md)             | Tooling, CI, configuration, the database, jobs, the shell, the image, the PWA                           | 11    |
| 2   | [Accounts and sign-in](accounts.md)     | Local and Sovereign sign-in, the sign-up policy, notices, deleting a person, the landing page, Settings | 6     |
| 3   | [People and groups](groups.md)          | Persons, groups and access, the lifecycle, merging                                                      | 4     |
| 4   | [Money and balances](money.md)          | Currencies, splitting and rounding, balances, across groups                                             | 4     |
| 5   | [Expenses and payments](expenses.md)    | Actions and validators, the write path with history, comments, activity                                 | 4     |
| 6   | [Offline and sync](sync.md)             | The endpoint, the device's store, Couldn't sync, opening offline, pruning                               | 5     |
| 7   | [Screens](screens.md)                   | The shell's places, adding an expense, a group, payments, an expense, Home, people, settings, the phone | 11    |
| 8   | [Bringing people in](invites.md)        | Mail, adding people and placeholders, invitations and claiming                                          | 3     |
| 9   | [Notices and reminders](notices.md)     | Notices and the bell, preferences and email, reminders                                                  | 3     |
| 10  | [Insights](insights.md)                 | Spending figures and their screens                                                                      | 2     |
| 11  | [The suite](suite.md)                   | Core's bell, email, activity and directory                                                              | 2     |
| 12  | [Portability](portability.md)           | Export and import                                                                                       | 2     |
| 13  | [Release](release.md)                   | Seed, security review, documents, the first release, hosting                                            | 5     |
| 14  | [Upstream, in `sovereign`](upstream.md) | Charts, `AvatarStack`, a floating button, `MoneyInput` and a currency picker, `AUTH_SIGNUP`, the port   | 6     |
