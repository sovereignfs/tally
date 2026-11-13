# Roadmap

The order of work. **This file tracks progress; it does not define behaviour.** [`DESIGN.md`](DESIGN.md) says what Tally does, and where it disagrees with this file, this file is stale and should be corrected. The detail of every task, with its technical notes and what makes it done, is in [`docs/epics/`](docs/epics/). How a task is run is in [`AGENTS.md`](AGENTS.md).

State as of 2026-11-13: **Milestone A built** (1.1 to 1.10 done; CI not yet seen to run on GitHub); group encryption added to the design (epic 15). The developer assigns each task; the first row not done, with its dependencies met, is what the order recommends.

_Status key: ✅ Done · ⏳ In progress · 📋 Planned · 🚧 Waits on a decision · ➖ Superseded_

_Priority:_ **P0** nothing else can stand without it · **P1** the product · **P2** needed before the first release · **P3** can follow the first release if it must

## How this is ordered

Tusk's order (building-an-app §14): conventions, configuration, database, sign-in, the shell, then the product, then the image and the release. Within the product:

1. **Keys, people and groups first** (B), so that no table is written without `group_id` and membership in its statement, and no group's words are
   ever written in plain text: a device has its key before the first group is made (`DESIGN.md` §5.3).
2. **The arithmetic and the one write path before any screen** (C): splitting, balances and applying a mutation are pure or server-side, and every later screen and the sync use them.
3. **Offline before the screens** (D), because the screens read the device's store: building them on server reads first would mean building them twice.
4. **The screens** (E) make it usable by people who already have accounts.
5. **Bringing people in** (F): placeholders and invitations, with mail.
6. **Notices and reminders** (G), then **insights** (H), which wait on charts in the design system.
7. **The suite and portability** (I), then the release (J). Sign-in through core is P0 but can come late, as Tusk's and Ledger's do: nothing before it depends on it.

**Epic 14 is work in `sovereign`**, tracked here because Tally waits on it: the design system's missing parts and the `invite` sign-up value. Each is started early enough to be released before the task that needs it.

## Phase 1 — the MVP

### Milestone A — Foundation

The repository can hold the app. Nothing a person would notice. **Done when** an empty database boots on all three forms from the image, and CI proves it.

| #   | ID                               | Task                             | Priority | Depends on | Status |
| --- | -------------------------------- | -------------------------------- | -------- | ---------- | ------ |
| 1   | [1.1](docs/epics/foundation.md)  | Repository conventions           | P0       | —          | ✅     |
| 2   | [1.2](docs/epics/foundation.md)  | Format, lint and test tooling    | P0       | 1.1        | ✅     |
| 3   | [1.3](docs/epics/foundation.md)  | Continuous integration           | P0       | 1.2        | ✅     |
| 4   | [1.4](docs/epics/foundation.md)  | Configuration and start-up       | P0       | 1.2        | ✅     |
| 5   | [1.5](docs/epics/foundation.md)  | The database layer               | P0       | 1.4        | ✅     |
| 6   | [1.8](docs/epics/foundation.md)  | Design system boundary and shell | P0       | 1.2        | ✅     |
| 7   | [1.7](docs/epics/foundation.md)  | Security headers                 | P0       | 1.4        | ✅     |
| 8   | [1.6](docs/epics/foundation.md)  | The job runner                   | P0       | 1.5        | ✅     |
| 9   | [1.9](docs/epics/foundation.md)  | Browser tests                    | P0       | 1.5        | ✅     |
| 10  | [1.10](docs/epics/foundation.md) | The image and deployment setups  | P0       | 1.5, 1.6   | ✅     |

### Milestone B — Accounts, people and groups

A person signs in, makes a group and is its owner, and every statement carries the permission. **Done when** a second person can reach nothing of a group they are not in, deleting a person leaves nothing personal, and the server holds no group's name in plain text.

| #   | ID                               | Task                             | Priority | Depends on     | Status |
| --- | -------------------------------- | -------------------------------- | -------- | -------------- | ------ |
| 11  | [15.1](docs/epics/encryption.md) | The cipher                       | P0       | 1.2            | 📋     |
| 12  | [2.1](docs/epics/accounts.md)    | Local sign-in                    | P0       | 1.5, 1.8, 15.1 | 📋     |
| 13  | [3.1](docs/epics/groups.md)      | Persons                          | P0       | 2.1            | 📋     |
| 14  | [4.1](docs/epics/money.md)       | Money and currencies             | P0       | 1.5            | 📋     |
| 15  | [15.2](docs/epics/encryption.md) | Account keys and unlocking       | P0       | 15.1, 2.1      | 📋     |
| 16  | [3.2](docs/epics/groups.md)      | Groups, members and access       | P0       | 3.1, 4.1, 15.2 | 📋     |
| 17  | [15.3](docs/epics/encryption.md) | Group keys and granting          | P0       | 15.2, 3.2      | 📋     |
| 18  | [15.4](docs/epics/encryption.md) | The recovery key                 | P1       | 15.2           | 📋     |
| 19  | [2.2](docs/epics/accounts.md)    | Landing page and the address `/` | P1       | 2.1            | 📋     |
| 20  | [2.5](docs/epics/accounts.md)    | Deleting a person                | P0       | 3.2            | 📋     |
| 21  | [2.6](docs/epics/accounts.md)    | Settings                         | P1       | 2.1, 1.8, 3.1  | 📋     |

### Milestone C — The arithmetic and the write path

Expenses, payments and comments can be written through the one path, and every figure comes from one pure module. **Done when** the property tests hold and a mutation is applied, refused and replayed correctly on all three databases.

| #   | ID                               | Task                                 | Priority | Depends on    | Status |
| --- | -------------------------------- | ------------------------------------ | -------- | ------------- | ------ |
| 22  | [4.2](docs/epics/money.md)       | Splitting and rounding               | P0       | 4.1           | 📋     |
| 23  | [4.3](docs/epics/money.md)       | Balances, pairwise and simplified    | P0       | 4.2           | 📋     |
| 24  | [5.1](docs/epics/expenses.md)    | Actions and validators               | P0       | 4.2, 3.2      | 📋     |
| 25  | [5.2](docs/epics/expenses.md)    | Applying a mutation                  | P0       | 5.1           | 📋     |
| 26  | [5.3](docs/epics/expenses.md)    | Comments                             | P1       | 5.2           | 📋     |
| 27  | [5.4](docs/epics/expenses.md)    | The activity log and its words       | P1       | 5.2, 3.2      | 📋     |
| 28  | [3.3](docs/epics/groups.md)      | Leaving, removing, closing, deleting | P1       | 3.2, 4.3, 5.2 | 📋     |
| 29  | [15.6](docs/epics/encryption.md) | Rotating a group's key               | P2       | 3.3, 15.3     | 📋     |

### Milestone D — Offline and sync

The device holds every group and records without a network. **Done when** two browsers, one offline, add and edit expenses in one group and both end with the same rows, with nothing lost and every refusal in Couldn't sync.

| #   | ID                               | Task                                | Priority | Depends on | Status |
| --- | -------------------------------- | ----------------------------------- | -------- | ---------- | ------ |
| 30  | [6.1](docs/epics/sync.md)        | The sync endpoint                   | P0       | 5.2        | 📋     |
| 31  | [6.2](docs/epics/sync.md)        | The device's store, outbox and loop | P0       | 6.1        | 📋     |
| 32  | [6.3](docs/epics/sync.md)        | Couldn't sync                       | P1       | 6.2        | 📋     |
| 33  | [1.11](docs/epics/foundation.md) | The PWA                             | P1       | 1.8        | 📋     |
| 34  | [6.4](docs/epics/sync.md)        | Opening offline                     | P1       | 6.2, 1.11  | 📋     |
| 35  | [6.5](docs/epics/sync.md)        | Keeping the history small           | P2       | 6.1, 1.6   | 📋     |

### Milestone E — The screens

The interface of `DESIGN.md` §15 on the device's data. **Done when** people with accounts can share a trip from first expense to closing the group, at desktop and phone widths.

| #   | ID                             | Task                                             | Priority | Depends on     | Status |
| --- | ------------------------------ | ------------------------------------------------ | -------- | -------------- | ------ |
| 36  | [14.4](docs/epics/upstream.md) | `MoneyInput` and a currency picker (`sovereign`) | P1       | —              | 📋     |
| 37  | [14.2](docs/epics/upstream.md) | `AvatarStack` (`sovereign`)                      | P1       | —              | 📋     |
| 38  | [14.3](docs/epics/upstream.md) | A floating action button (`sovereign`)           | P1       | —              | 📋     |
| 39  | [7.1](docs/epics/screens.md)   | The shell's places and the groups list           | P1       | 6.2, 3.2       | 📋     |
| 40  | [7.2](docs/epics/screens.md)   | Adding an expense                                | P1       | 7.1, 6.2, 14.4 | 📋     |
| 41  | [7.3](docs/epics/screens.md)   | A group: expenses                                | P1       | 7.2            | 📋     |
| 42  | [7.4](docs/epics/screens.md)   | A group: balances                                | P1       | 7.3, 4.3       | 📋     |
| 43  | [7.5](docs/epics/screens.md)   | Payments and settling up                         | P1       | 7.4            | 📋     |
| 44  | [7.6](docs/epics/screens.md)   | An expense: comments and history                 | P1       | 7.3, 5.3       | 📋     |
| 45  | [4.4](docs/epics/money.md)     | Across groups                                    | P1       | 4.3            | 📋     |
| 46  | [7.7](docs/epics/screens.md)   | Home                                             | P1       | 7.5, 4.4, 14.2 | 📋     |
| 47  | [7.8](docs/epics/screens.md)   | People and a person                              | P1       | 7.5, 4.4       | 📋     |
| 48  | [7.9](docs/epics/screens.md)   | A group's settings                               | P1       | 7.3, 3.3       | 📋     |
| 49  | [7.10](docs/epics/screens.md)  | Activity                                         | P1       | 5.4, 7.1       | 📋     |
| 50  | [7.11](docs/epics/screens.md)  | The phone                                        | P1       | 7.7, 7.8, 14.3 | 📋     |

### Milestone F — Bringing people in

People outside can be in a group before they have an account, and take their place later. **Done when** journeys 3 and 4 of `DESIGN.md` §3 pass in a browser, alone and with no mail set up.

| #   | ID                               | Task                                      | Priority | Depends on     | Status |
| --- | -------------------------------- | ----------------------------------------- | -------- | -------------- | ------ |
| 51  | [8.1](docs/epics/invites.md)     | The mail outbox                           | P1       | 1.6            | 📋     |
| 52  | [8.2](docs/epics/invites.md)     | Adding people and placeholders            | P1       | 7.9, 3.1       | 📋     |
| 53  | [14.5](docs/epics/upstream.md)   | `AUTH_SIGNUP` by invitation (`sovereign`) | P1       | —              | 📋     |
| 54  | [8.3](docs/epics/invites.md)     | Invitations and claiming                  | P1       | 8.1, 8.2, 14.5 | 📋     |
| 55  | [15.5](docs/epics/encryption.md) | An invitation link that carries the key   | P1       | 8.3, 15.3      | 📋     |
| 56  | [3.4](docs/epics/groups.md)      | Merging a placeholder                     | P2       | 8.2, 5.2       | 📋     |

### Milestone G — Notices and reminders

People hear about what concerns them. **Done when** each kind of notice reaches the right people through the bell and, where on, by email, and never the person who acted.

| #   | ID                           | Task                  | Priority | Depends on | Status |
| --- | ---------------------------- | --------------------- | -------- | ---------- | ------ |
| 57  | [9.1](docs/epics/notices.md) | Notices and the bell  | P1       | 5.2, 7.1   | 📋     |
| 58  | [9.2](docs/epics/notices.md) | Preferences and email | P1       | 9.1, 8.1   | 📋     |
| 59  | [9.3](docs/epics/notices.md) | Reminders             | P1       | 9.2, 4.3   | 📋     |

### Milestone H — Insights

Looking back at what was spent. **Done when** every figure matches a hand-worked seed, with charts and their tables.

| #   | ID                             | Task                 | Priority | Depends on      | Status |
| --- | ------------------------------ | -------------------- | -------- | --------------- | ------ |
| 60  | [14.1](docs/epics/upstream.md) | Charts (`sovereign`) | P1       | —               | 📋     |
| 61  | [10.1](docs/epics/insights.md) | The figures          | P1       | 4.2             | 📋     |
| 62  | [10.2](docs/epics/insights.md) | The screens          | P1       | 10.1, 7.3, 14.1 | 📋     |

### Milestone I — The suite, and the person's data

Part of the suite, and a person can leave. **Done when** it signs in through core, honours both notices, finds people in the directory, notifies through core's bell, and a person's groups round-trip through a file.

| #   | ID                                | Task                         | Priority | Depends on | Status |
| --- | --------------------------------- | ---------------------------- | -------- | ---------- | ------ |
| 63  | [2.3](docs/epics/accounts.md)     | Sign-in through core         | P0       | 2.1, 3.1   | 📋     |
| 64  | [2.4](docs/epics/accounts.md)     | Core's notices               | P0       | 2.3, 2.5   | 📋     |
| 65  | [11.1](docs/epics/suite.md)       | Core's bell, email, activity | P2       | 2.3, 9.2   | 📋     |
| 66  | [11.2](docs/epics/suite.md)       | Core's directory             | P2       | 2.3, 8.2   | 📋     |
| 67  | [12.1](docs/epics/portability.md) | Export                       | P2       | 5.3, 3.3   | 📋     |
| 68  | [12.2](docs/epics/portability.md) | Import                       | P2       | 12.1, 8.2  | 📋     |

### Milestone J — Release

**Done when** 0.1.0 is published and hosted on the live instance.

| #   | ID                             | Task                                    | Priority | Depends on      | Status |
| --- | ------------------------------ | --------------------------------------- | -------- | --------------- | ------ |
| 69  | [13.1](docs/epics/release.md)  | Development seed                        | P1       | 8.3, 5.3        | 📋     |
| 70  | [14.6](docs/epics/upstream.md) | Tally's port in the guide (`sovereign`) | P3       | —               | 📋     |
| 71  | [13.3](docs/epics/release.md)  | Documents                               | P2       | 1.10            | 📋     |
| 72  | [13.2](docs/epics/release.md)  | Security review                         | P2       | 12.2, 9.3, 11.2 | 📋     |
| 73  | [13.4](docs/epics/release.md)  | Release 0.1.0                           | P2       | 13.2, 13.3      | 📋     |
| 74  | [13.5](docs/epics/release.md)  | Hosting on an instance                  | P2       | 13.4            | 📋     |

## Phase 2 — candidates

None committed (`DESIGN.md` §21): receipts, currency conversion, recurring expenses, Push notifications, import from Splitwise, people and invitations offline, live updates.
