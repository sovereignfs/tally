# Tally — design

**Status:** draft, written on 2026-11-09 from the legacy `sovereign-plugin-tally` (manifest 0.17.1), Tusk's and Ledger's designs, and the owner's
direction in planning. Nothing is built. Where this file and a contract Sovereign publishes disagree, the contract wins (`AGENTS.md`, Source of truth).
§23 holds what is still waiting on a decision (nothing, for now), and §24 what has been decided and why.

[`ROADMAP.md`](ROADMAP.md) puts the work in order, and [`docs/epics/`](docs/epics/) holds each task's detail.

---

## 1. Purpose

Tally is money shared between people: a trip, a flat, a dinner club. People record what they spent for the group, Tally keeps everyone's balance, and
when they pay each other back outside the app, they record that too. It is the job Splitwise does, with no limit, no advert and no paid tier, on a
server its people chose. It is an app of the Sovereign suite exactly as Tusk, Fjord and Ledger are: a program of its own, which an instance can host,
and which needs no instance to run.

Tally replaces the legacy plugin `sovereign-plugin-tally`. Its behaviour is the starting point; none of its code is carried over and none of its data is
migrated (§24). Its interface is designed anew (§15).

What it must not give up, whatever the convenience:

- **It works alone.** Every feature works on a Tally with no Sovereign instance: its own accounts, its own people, its own mail, its own notices. An
  instance adds a way to sign in, a directory to find people in, and core's bell and email; it is never what a feature depends on (§14).
- **Recording is never held up.** Adding an expense, a payment or a comment works with no network, answers at once, and syncs in the background
  (§11). A person on a plane or in the mountains does not notice they are offline until they look for someone else's latest entry.
- **The numbers add up.** What the payers paid equals the expense, and the shares equal it too, to the minor unit. A balance is never typed: it is
  derived from expenses and payments (§10). An edit never loses the version it replaced (§8.5).
- **Currencies stay themselves.** A balance is kept per currency. Nothing is converted, and no figure ever blends two currencies.
- **People outside are first-class.** Someone with no account can be in a group from the first expense, as a placeholder, and later claim their place
  with everything recorded for them (§6.3).
- **A person can leave.** One file holds what is theirs to take (§17). Deleting the account removes their email and everything else personal, and keeps
  only their name on the shared record, so that the others' numbers still add up (§18).

What it is not: a payment app (it never moves money and never connects to a bank), a personal budget (that is Ledger), or a currency converter.

## 2. Phases

| Phase          | What it delivers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1, the MVP** | On the web, responsive and installable: sign-in, locally and through core; people and placeholders; invitations by link and email; groups with owners and members; expenses with several payers, four ways to split, a category, comments and their history; payments, suggested and recorded; balances per currency, pairwise or simplified; recording offline with background sync; notices in the app and by email; reminders; insights with charts; export, import and deletion. Runs alone or hosted. |
| **2**          | Candidates, none committed: receipts, currency conversion, recurring expenses, Push notifications, import from Splitwise, adding people and invitations offline, live updates. §21 outlines each.                                                                                                                                                                                                                                                                                                          |

### 2.1 What is carried over

The plugin's task numbers are not used here. This table is how to check nothing was lost.

| Plugin                                                                            | Here                                                                                                                 |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Groups: name, description, default currency                                       | §7.1. **Start and end dates are dropped**: nothing used them                                                         |
| Members: instance users through `sdk.directory`, guests by name and email         | §6: people of Tally's own, **placeholders** in place of guests, claimed through an invitation; directory when hosted |
| Owner and member roles, last-owner guard                                          | §7.2                                                                                                                 |
| Close, reopen, delete only when empty, leave and remove with a zero balance       | §7.3                                                                                                                 |
| Simplify debts per group, off by default                                          | §10.3                                                                                                                |
| Expenses: several payers, four split methods, category, note, date                | §8                                                                                                                   |
| Remainder rule for splits                                                         | §8.3, now per currency's minor unit, not cents                                                                       |
| Edit and delete by any member, soft delete                                        | §8.5, now with the history the plugin never built                                                                    |
| — (Splitwise has them)                                                            | Comments, §8.6                                                                                                       |
| Payments: suggested Settle up, Record payment, settle with a person across groups | §9                                                                                                                   |
| Balances per currency, cross-group by person, never converted                     | §10                                                                                                                  |
| Overview: owed and owe, stats, breakdowns; spend by category and by month         | Home (§15.4) and Insights (§13), with charts built in `@sovereignfs/ui` first                                        |
| Inbox: one feed with Remind and Resend                                            | Activity (§12.1), the bell (§12.2) and reminders (§12.4)                                                             |
| Notifications and activity through the platform                                   | §12: the app's own notices, with core's bell and email when hosted                                                   |
| Receipts through `sdk.storage`                                                    | Phase 2 (§21.1), stored by Tally itself                                                                              |
| Primary currency setting                                                          | §16                                                                                                                  |
| Export, import, delete through `sdk.portability`                                  | §17, §18, as the app's own                                                                                           |
| Mobile fork with its own footer and drill-down                                    | §15.11: one responsive tree, a PWA                                                                                   |
| Tenants, `sdk.db`, `sdk.authz`, the plugin manifest                               | Gone with the legacy runtime (§14, §19)                                                                              |

## 3. User journeys

1. **First visit, alone.** Someone runs the image (§20). They make the first account, set their primary currency, and land on Home, which offers one
   thing: create a group.
2. **First visit, on an instance.** They open Tally from the launcher and sign in through core. The same Home.
3. **A trip with a friend who has no account.** Kasun makes _Lisbon_ in EUR and adds Thulana, who has an account here, and Sam, who does not: Sam is
   added by name and email as a placeholder, and an invitation goes to Sam's address. Expenses include Sam from the first one.
4. **Sam joins.** Sam opens the invitation, creates an account (sign-up is by invitation on this server, §6.4), and finds _Lisbon_ with every expense
   and their balance already there.
5. **Offline on the road.** On a bus with no signal, Thulana adds _Tram tickets, 9.60, paid by me, split equally_. It shows at once with a small clock
   mark. When the phone finds a network, it syncs; Kasun sees it on his next look.
6. **Two people correct one bill.** Kasun changes the dinner to 84.00 while Thulana, offline, changes who it was split between. Thulana's edit reaches
   the server later and stands; Kasun's is kept in the expense's history, and he is told his edit was replaced (§11.4).
7. **Settle up.** Back home, Sam owes Kasun 63.20. Sam opens Kasun's page, presses _Settle up_, confirms, and their balance in _Lisbon_ is zero.
8. **A nudge.** Thulana still owes 41.00 after a week. Kasun presses _Remind_; Thulana gets a notice and an email. Kasun cannot remind again for a day.
9. **A question about a bill.** Sam comments on _Dinner at Ramiro_: "Did this include the wine?" Kasun, who paid, is notified and answers.
10. **Close the trip.** Everyone is settled. Kasun closes _Lisbon_; it is read-only, and can be reopened.
11. **Look back.** Insights shows what each of them spent on the trip by category, and Kasun's own share of everything this year by month.
12. **Leave.** Sam deletes their account. Their email and sign-in are gone; past expenses still say "Sam", and nobody's numbers change.

## 4. Terminology

| Term                 | Meaning                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Account**          | Someone who can sign in. In code, `account_id` is the better-auth user id (as in Tusk)                                        |
| **Person**           | Someone who can be in a group: every account has one, and a placeholder is one without an account (§6.1). `person_id` in code |
| **Placeholder**      | A person with no account yet, added by name (and an email if known). On screen: "not on Tally yet"                            |
| **Invitation**       | A single-use link that lets someone claim a placeholder (§6.3)                                                                |
| **Group**            | People who share expenses: their members, expenses, payments and settings (§7)                                                |
| **Member**           | A person's place in a group, with a role (`owner`, `member`). What expenses and payments point at (§7.2)                      |
| **Expense**          | Money spent for the group: who paid, how much, and who it was for (§8)                                                        |
| **Payer**, **share** | What a member paid of an expense; what a member's part of it is                                                               |
| **Payment**          | Money one member gave another outside Tally, recorded to settle up (§9). Code says `payment`, never `settlement`              |
| **Balance**          | What a member is owed (positive) or owes (negative) in a group, per currency (§10)                                            |
| **Simplify debts**   | A group setting: suggested payments are the fewest that settle everyone, rather than pairs who actually shared a bill (§10.3) |
| **Notice**           | Something a person is told, in the bell (§12.2)                                                                               |
| **Activity**         | What happened in a group, for its members to read (§12.1)                                                                     |
| **Outbox**           | Changes made on a device and not yet accepted by the server (§11)                                                             |

User-facing text says "expense", "payment", "settle up", "you owe", "owes you", "not on Tally yet", "group", "app"; never "settlement", "debt
simplification", "guest", "ledger entry", "debit", "credit", "client" or "plugin". Owed amounts are shown without a minus sign, with words.

## 5. Architecture

```
            browser (a PWA)                                       server (one image, one process)
 ┌───────────────────────────────────────┐              ┌──────────────────────────────────────────────────┐
 │ UI (React 19, @sovereignfs/ui)        │              │ Next.js: the shell, routes, server actions        │
 │ reads and writes the device's store:  │  /api/sync   │ better-auth (§14)                                 │
 │   IndexedDB, one database per account │ ◀──────────▶ │ sync: checks, orders and stores changes (§11)     │
 │ actions: pure, shared with the server │              │ /api/ops: groups, people, invitations (online)    │
 │ balances and insights: pure, computed │  /api/ops    │ balances and insights: the same pure modules      │
 │   on the device                       │ ◀──────────▶ │ notices, reminders, mail outbox                   │
 │ service worker: the shell, Background │              │ jobs: mail, pruning                               │
 │   Sync                                │              └───┬──────────────────┬───────────────────┬───────┘
 └───────────────────────────────────────┘                  │                  │                   │
                                                     SQLite (sqld or      SMTP (Tally's own,   a Sovereign core,
                                                     a file) or           when set)            if one is set
                                                     PostgreSQL (§19)
```

- **Offline first for what is recorded, online for what is decided.** Expenses, payments and comments are written to the device and synced (§11), as
  Tusk's Desk is. Groups, membership, roles and invitations are changes the server must decide at once, so they are online operations (`/api/ops`), as
  Tusk's boards are (§11.6).
- **The server is the referee,** not a bystander: it checks every change against membership, the group's state and the arithmetic, orders it, and hands
  it to the other members' devices. It reads every field, which is why Tally has no end-to-end encryption (§24): it must validate sums and send
  reminders.
- **What can be pure is pure:** splitting and rounding, balances, pairwise debts, simplification, insights, describing an activity in words, and
  building a mutation from an action. They take rows and the time as arguments, and the same module runs in the browser and on the server, so a figure
  has one implementation.
- **Next.js with React 19**, a long-running server, because of the jobs.
- **SQLite by default, in production too, and PostgreSQL if the operator prefers** (§19).
- **Jobs run in the web process** on a timer from `instrumentation.ts`, with `TALLY_WORKER=off` for all but one process if several share a database;
  every job claims its work in the database, so two running it is safe anyway (Tusk §5).
- **The server talks to SMTP and to core.** The browser talks only to its own server.

### 5.1 Where things go

As Tusk's: `app/` for routes, `src/` for everything else, tests beside the code.

| Path                      | What                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `app/`                    | Routes: the landing page, sign-in, the invitation page, the signed-in area, `/api/*`                                     |
| `src/db/`                 | Configuration, clients, schemas per dialect, migrations at start-up (§19) — **copied from Tusk**                         |
| `src/auth/`               | better-auth, its settings, the sign-up policy, the screens, the fake Sovereign for tests (§14) — **copied from Tusk**    |
| `src/access/`             | Every page, route and operation with who may use it; the membership conditions; input parsers (§5.2)                     |
| `src/money/`              | Minor units, currencies and their decimals, formatting, splitting and rounding (§8.3) — pure; currencies **from Ledger** |
| `src/balances/`           | Net balances, pairwise debts, simplification, the cross-group view (§10) — pure                                          |
| `src/actions/`            | Each recorded action as a pure function from intent to a mutation, and the validators (§11.2) — shared with the browser  |
| `src/sync/`               | The protocol, `/api/sync`, applying a mutation, cursors, tombstones (§11) — the shape **from Tusk's Desk**               |
| `src/local/`              | The device's store, the outbox, the sync loop, Couldn't sync (§11) — browser only; the shape **from Tusk's Desk**        |
| `src/people/`             | Persons, finding people, placeholders, invitations, claiming (§6)                                                        |
| `src/groups/`             | Groups, members, roles, lifecycle, the operations (§7)                                                                   |
| `src/activity/`           | The activity log and its words (§12.1)                                                                                   |
| `src/notices/`            | Notices, preferences, delivery, reminders (§12)                                                                          |
| `src/insights/`           | Spending figures for the charts (§13) — pure                                                                             |
| `src/portability/`        | The file format, export and import (§17)                                                                                 |
| `src/sovereign/`          | Core's notices, `People.deletePerson`, the bell, email, activity and directory calls (§14, §18) — **from Tusk**          |
| `src/jobs/`               | The runner and claims — **copied from Tusk**                                                                             |
| `src/crypto/`             | The instance key and envelope encryption — **copied from Tusk**, for core's refresh tokens (§14.4)                       |
| `src/mail/`               | The SMTP mailer and the mail outbox — the mailer **copied from Tusk**                                                    |
| `src/sw/`                 | The service worker: the shell by allow-list, the offline shell page, Background Sync — **from Tusk**                     |
| `src/screens/`, `src/ui/` | The signed-in screens and the shell                                                                                      |
| `migrations/`, `deploy/`  | Generated SQL (`sqlite/`, `postgres/`, `auth/`); the Compose setups                                                      |

**Copied from Tusk** (building-an-app §15: until the kit is published, an app copies, and says which files): `src/db/`, `src/jobs/`, `src/auth/` and its
fake Sovereign, `src/sovereign/`, `src/crypto/`, `src/mail/`, `src/config/`, `src/security/` and `proxy.ts`, `src/limits/`, `src/sw/`, `src/theme/`,
the shape of Tusk's sync (`src/sync/`, the Desk's local store and loop), `scripts/`, the Dockerfile and `deploy/`. **From Ledger:** the currency table
and its generator. Each is renamed to `TALLY_` and trimmed of what Tally does not use (workspaces, the cipher, backup to git); none is changed in
behaviour without saying so in its task.

### 5.2 Access

**The permission is in the statement.** Every row of a group carries `group_id`, and every read and write names it together with membership:
`… WHERE group_id = ? AND EXISTS (SELECT 1 FROM member m JOIN person p ON p.id = m.person_id WHERE m.group_id = ? AND p.account_id = ? AND
m.left_at IS NULL)`. Never checked first and then touched; a refusal reads as not found. Anything a change points at (a member, an expense) must be
the same group's, in the same statement. An owner's operation adds `AND m.role = 'owner'`.

- **Sync applies the same rule per mutation** (§11.5): a mutation for a group the account is not an active member of is refused, not ignored.
- `src/access/routes.ts` lists every page, route and operation with who may use it; a test calls each as a second signed-in person and expects not found.
- **Pull hands a device only its groups:** rows of a group the account has left stop arriving, and the device deletes its copy (§11.3).

## 6. People

### 6.1 A person

`person` is Tally's own record of someone who can be in a group: a name, an email if known, and the account if they have one. **Every account has
exactly one person,** made with the account, its name and email copied from sign-in and kept in step when the person changes them in Settings. A
**placeholder** is a person with no account.

This is a deliberate difference from Tusk, which reads names from the auth store and copies nothing (§24): Tally needs a name for people who have no
account, and a name that outlives an account (§18). It also means **no feature depends on core for who someone is:** core's directory is one more way
to find a person (§6.2), never where their name lives.

- **A name** is what every member sees. **An email** is seen by the person themselves and by the owners of a group they are in, and by whoever added a
  placeholder; never by other members, and never in a notice, an activity line or an export of someone else.
- A placeholder belongs to whoever added it until it is claimed: the same "Sam" can be added to several of Kasun's groups, and a claim takes them all.
- A placeholder can be renamed, and its email changed, by whoever added it or an owner of a group it is in.

### 6.2 Adding people to a group

From the group's settings, **Add people**, one field:

- **Typing a name** offers people the adder already shares a group with, and their own placeholders.
- **On an instance with the directory** (§14.4), the same field also searches core's directory by name. Choosing someone found there adds a person
  linked to their `sub`, with the name the directory gave; when they first sign in to Tally through core, their account claims that person by `sub`
  (identity, never email: §14.2), and core's bell tells them they were added.
- **Typing an exact email** that belongs to an account here adds that account's person. One that does not becomes a placeholder with that email, and an
  invitation is sent (§6.3). Telling apart the two cases tells the adder whether an address has an account, so it is limited per account and per hour, as
  Tusk's is.
- **Typing a name and choosing "Add as not on Tally yet"** adds a placeholder with no email; an invitation link can be made for it later.

**Any member can add people;** removing them and roles are owners' (§7.2). Being added raises a notice for an account (§12.2).

### 6.3 Invitations and claiming

An invitation lets someone take a placeholder's place, with every expense, share and payment it already has.

- **One live invitation per placeholder,** made when an email is given or on request ("Invite Sam"), by any member of a group the placeholder is in. It
  is a random token of 32 bytes, stored only as its hash, compared in constant time, valid for 14 days, single-use, and revocable. Making a new one
  revokes the old.
- **Delivered by email** through Tally's mail (§12.3) when an address is known and mail is set up; **always available as a link** to copy and send any
  other way. With no mail set up, the screen says the link is the only way, rather than pretending an email went.
- **`/invite/<token>`** shows the group's name and who invited, and nothing else. It offers to sign in, or to create an account, which the sign-up
  policy allows for an invitation even when sign-up is otherwise by invitation only (§6.4), and through core when core is set.
- **Accepting claims the placeholder** in one transaction: every `member` row of that placeholder is pointed at the accepting account's person, the
  placeholder's email is dropped, and the placeholder is deleted. If the account is already a member of one of those groups, the claim is refused for
  that group with a sentence that says so, and an owner can merge them (§7.2).
- **The link is the key:** whoever holds it can claim, as Splitwise's is, whatever address it was sent to. The inviter is told who accepted (§12.2).
- **Resend** sends the same invitation again, limited to once an hour.

### 6.4 Who may sign up

`TALLY_AUTH_SIGNUP` decides who may make a local account, one policy in better-auth's user-creation hook, as Tusk's:

| Value                  | Local sign-up                                                            |
| ---------------------- | ------------------------------------------------------------------------ |
| `invite` (**default**) | The first account, and anyone holding a valid invitation                 |
| `open`                 | Anyone                                                                   |
| `closed`               | The first account only; an invitation can be accepted only by signing in |

**Signing in through core always gets an account,** whatever the value: the instance has already decided who may be there (`app-manifest.md` §4).
The value `invite` is not yet in `contracts/env.md`, which allows `open` and `closed`; adding it there for every app is a task in `sovereign` that comes
first (§22).

## 7. Groups

### 7.1 A group

A name, a colour (one of the design system's accent tokens, shown as the group's dot), a **default currency** (pre-filling its expenses; from the
creator's primary currency), **simplify debts** (off by default, §10.3), and whether it is closed. Its members, expenses, payments, comments and
activity belong to it and carry its `group_id`.

### 7.2 Members and roles

| Who        | May                                                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Member** | Read everything in the group; add, edit, delete and restore any expense or payment (Splitwise's trust model); comment; add people and invite; remind; leave                      |
| **Owner**  | Also: rename and recolour the group, change its currency and simplify debts; make and unmake owners; remove members; merge a placeholder into a member; close, reopen and delete |

- **A group always has an owner.** The last owner cannot leave, be removed or step down until another member is made owner.
- **The creator is its first owner.** A placeholder holds no role: it cannot sign in to use one.
- **Merge** (owners): when one person is in a group twice (a placeholder for someone who later joined by other means), the placeholder's expenses,
  shares and payments are moved to the member, in one transaction, recorded in the activity.

### 7.3 Lifecycle

- **Leave and remove** are refused while that member's balance in any currency is not zero, with the amounts in the sentence; settle first, as in
  Splitwise. A member who leaves keeps their name on everything past ("split with Jamie (left)"), since a membership row is never deleted once
  something points at it.
- **Close** is refused while any member's balance is not zero. A closed group is read-only: no expense, payment or comment, and its devices are told so
  at the next sync (§11.5). An owner can **reopen** it.
- **Delete** is offered only for a group that has never had an expense or a payment (deleted ones count), and removes everything of it, by `group_id`,
  in one transaction. Every real group is closed, not deleted.
- **Limits:** 50 members a group; 200 groups an account. Both are checked by the server and say so.

## 8. Expenses

### 8.1 An expense

A description (required, up to 200 characters), an amount, a currency, a date (`YYYY-MM-DD`, no time zone; today by default), a category (§8.4), a
note (up to 2,000 characters), its payers (§8.2), its split (§8.3), and who made and last changed it. **The amount is positive;** a refund is recorded
as a payment, or by editing the expense.

### 8.2 Payers

One or more members paid it; what they paid adds up to the amount exactly. The default is the person adding it, paying all of it. A placeholder can be
a payer (someone recorded what Sam paid).

### 8.3 The split

The members it was for, and how it divides, by one of four methods, which are `SplitMethodSelector`'s:

| Method          | Input per member                       | Share                                                      |
| --------------- | -------------------------------------- | ---------------------------------------------------------- |
| **Equally**     | Included or not                        | The amount divided evenly                                  |
| **Amounts**     | An amount                              | That amount; together they must equal the expense          |
| **Percentages** | Basis points (`2500` = 25.00%)         | The amount × the percentage; together they must be 100.00% |
| **Shares**      | A weight (×100, so `150` = 1.5 shares) | The amount × weight ÷ total weight                         |

- **What is stored is the share in minor units, for every method,** with the input kept beside it (`units`) only so that editing shows what was typed.
  Balances read shares and never look at the method.
- **Rounding is one pure function** (`src/money/split.ts`): compute each share rounded down, then give the minor units left over, one each, to the
  members in a fixed order: the group's member order (when they joined, then id). The order does not depend on how the form listed them, so the same
  split always gives the same shares on any device, and editing an expense twice never moves a cent.
- **A currency's minor unit is its own** (JPY has none, BHD three), from the currency table (§8.7). The plugin's assumption of cents is not carried
  over.
- **The server recomputes** the shares from the method and input, and refuses a mutation whose shares differ from its own result (§11.5).

### 8.4 Categories

A fixed list, each with an icon from the design system: General, Groceries, Eating out, Rent, Utilities, Transport, Travel, Entertainment, Shopping,
Health, Gifts, Other. Custom categories are not in phase 1 (§24). Each group remembers the last category used, on the device.

### 8.5 Editing, deleting and history

- **Any member can edit an expense,** and an edit replaces the whole expense (its fields, payers and split together), never field by field: an amount
  and a split that must add up cannot be merged from two people's edits (§11.4).
- **Every change keeps the version it replaced** in `revision`: created, edited, deleted, restored, and replaced in a conflict, with who and when. The
  expense's page shows its history in words ("Kasun changed the amount from 80.00 to 84.00").
- **Delete** marks it deleted; it leaves every balance and stays in the group's activity, and **Restore** brings it back. Deleted expenses can be
  listed in the group.

### 8.6 Comments

A member can comment on an expense or a payment: plain text up to 2,000 characters, rendered as text. The author can delete their own; nobody edits
one. Comments sync like expenses and can be written offline (§11). A comment notifies the expense's payers and members in its split, and earlier
commenters, except the author (§12.2). A closed group takes no comments.

### 8.7 Currencies

Every ISO 4217 fiat currency, each with its decimals, from a table generated from ICU (Ledger's `src/money/currencies.ts` and its generator, copied).
Money is an integer of minor units, always; it is formatted with its currency's decimals in the reader's locale, with the code where it could be
mistaken. The currency picker offers the person's primary currency, the group's, and those recently used first.

## 9. Payments

A payment records that one member gave another money outside Tally: from, to, amount, currency, date, and an optional note. It can involve a
placeholder. It can be edited, deleted and restored by any member, with history, as an expense is (§8.5).

- **Settle up** offers the suggested payments (§10.3, §10.2) that involve the person, each pre-filled; one press and a confirmation records it.
- **Record a payment** is the same form, empty: a partial payment, an earlier date, a pair the suggestions did not name.
- **Settle up with a person** (their page, §15.7) records, behind one confirmation, one payment for every group and currency in which the two have a
  balance between them, exactly as if each group had been settled in turn. There is no payment across groups in the data.
- Nothing moves money. A payment is a record of something that already happened.

## 10. Balances

Pure functions in `src/balances/`, over a group's rows, run in the browser for the screens (so they work offline) and on the server for reminders and
guards. Never stored: a group has dozens to a few thousand rows, and recomputing is cheap.

### 10.1 A member's balance

Per member and currency, over expenses and payments not deleted:

```
balance(member, currency) =   what they paid of expenses in that currency
                            − their shares of expenses in that currency
                            + payments they received in that currency
                            − payments they made in that currency
```

Positive is owed to them; negative is what they owe; zero is settled up, the sign `BalanceChip` expects. In every group and currency the balances add
up to zero, which a property test holds (§20).

### 10.2 Who owes whom: pairwise

With simplify debts off (the default), who owes whom is derived from who actually shared what:

- For each expense, each member's share is owed to the payers in proportion to what each paid, divided with the same rounding rule (§8.3) so that the
  pieces add up to the share exactly. What a member owes themselves cancels.
- A payment reduces the debt between its two members directly.
- The pairs net out (what A owes B less what B owes A), per currency. A member's pairwise debts always add up to their balance.

So a suggested payment only ever names two people who split a bill together.

### 10.3 Who owes whom: simplified

With simplify debts on, the suggested payments are the fewest that settle everyone, from the balances alone: the largest creditor is paid by the
largest debtor, and so on, ties broken by member order so that every device suggests the same payments. It is the greedy minimum-cash-flow algorithm;
it can name two people who never shared a bill, which is what the setting says it does.

### 10.4 Across groups

A person's view of someone else (§15.7) and Home (§15.4) add up, per currency, what lies between the two in each group they share: the pairwise debt,
or with simplify on, the suggested payments between them. Never a figure in two currencies; the primary currency is listed first (§16).

## 11. Offline and sync

The design goal is Tusk's: **a person does not feel any of this.** Recording never waits for the network, shows no conflict dialog and needs no
"saving" sign. What Tusk built for the Desk, which is one person's, is carried over and changed where a group is shared by several people.

### 11.1 The model

- **The device holds every group the account is in:** its members (names only), expenses with payers and shares, payments, comments, and the group's
  settings, in IndexedDB through `idb`, one database per account (`tally-<account id>`). Screens read from it, and balances and insights are computed
  from it (§10, §13), so everything is readable offline.
- **A recorded action is written to the device at once** and, in the same IndexedDB transaction, to the outbox. The sync loop sends it.
- **The server checks, orders and stores it** and hands it to the other members' devices (§11.5).

### 11.2 Mutations

An action ("add this expense", "delete that payment") is a pure function in `src/actions/` that turns intent into a **mutation**: one or more row
changes, with an id.

```json
{
  "mutationId": "…",
  "groupId": "…",
  "changes": [
    {
      "table": "expense",
      "id": "…",
      "baseVersion": 3,
      "row": {
        "description": "Dinner at Ramiro",
        "amount": 8400,
        "currency": "EUR",
        "date": "2026-11-02",
        "category": "eating_out",
        "note": null,
        "method": "equal",
        "payers": [{ "memberId": "…", "amount": 8400 }],
        "shares": [{ "memberId": "…", "amount": 2800, "units": null }]
      }
    }
  ]
}
```

- **Ids are made by the device,** so a new expense exists at once and a comment can point at it offline. A mutation's id makes sending it twice harmless:
  the server records what it has applied.
- **What syncs offline:** creating, editing, deleting and restoring expenses and payments; creating and deleting comments. Everything else is online
  (§11.6).
- **An expense or payment travels whole,** with `baseVersion`, the version the device edited (§11.4). A comment is only ever made or deleted.
- **The validators are one module,** run by the browser before it queues and by the server before it applies.

### 11.3 The endpoint

`POST /api/sync`, with the session cookie and `Origin` checked. A request carries the outbox in order, and a cursor per group; the answer carries what
was applied, what was refused and why, the account's current list of groups, and the changes since each cursor.

- **Order is a counter per group** (`grp.seq`), not per account as on Tusk's Desk, since several people write to one group. Applying a mutation is one
  short transaction: increment the group's `seq`, stamp each changed row with it, write the revision and activity, record the mutation id. The increment
  serialises one group's writes without holding up any other group.
- **Pull** returns, per group, rows whose `seq` is past the cursor, paged at `seq` boundaries. A group new to the device starts at zero, which is its
  snapshot. A group the account is no longer in is named as gone, and the device deletes its copy.
- **A device syncs** after a write (debounced), on load, when the tab regains focus, when it comes back online, every 30 seconds while visible, and
  through Background Sync where there is one. One tab syncs at a time (Web Locks); the others see the store change (BroadcastChannel).
- **Retrying is safe,** and a lost answer is only a retry. **A protocol version** travels with each request; a device too old is told to update, and
  keeps its outbox.
- **Freshness without live updates:** another member's expense arrives at the next pull, within half a minute while Tally is open. Live updates are
  phase 2 (§21.7).

### 11.4 Conflicts

Resolved by rule, in the background, with nothing asked:

| What happened                                          | What results                                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two members add expenses, payments or comments         | All stand: each is new                                                                                                                                                          |
| Two members edit one expense or payment                | The edit that reached the server later stands, whole. The one it replaced is kept in history as **replaced**, and its author gets a notice with a link to restore their version |
| One member edits what another deleted                  | The edit restores it: losing someone's work is worse than a deleted expense coming back                                                                                         |
| Both delete                                            | Deleted                                                                                                                                                                         |
| A comment is made on an expense another member deleted | The comment stands, on the deleted expense, which shows it if restored                                                                                                          |

### 11.5 What the server refuses, and what the person sees

The server re-checks everything, whatever the device said: the account is an active member of the group; the group is open; every member named is the
group's, and active, or already on the version being edited; the payers and shares add up; the shares match the method (§8.3); the currency and
category are known; the sizes are within limits.

**A refused expense or payment is not thrown away.** It leaves the group's screens and goes to **Couldn't sync** (Settings, and a quiet mark on the
avatar), with the reason in a sentence: "Lisbon was closed", "You're no longer in Roomies", "Sam is no longer in this group". From there it can be
fixed and sent again, moved to another group, or discarded. Someone's typed expense from a trip is never lost to a rule they could not see coming. A
refused comment is undone with a toast that says why.

### 11.6 What needs a network

Stated in the app and in the user's documentation:

- **Signing in, and the first load on a device.**
- **Creating a group, adding and removing people, invitations, roles, closing, reopening and deleting** (`/api/ops`, which answers at once and is
  undone with a toast on a refusal, as a Tusk board is). Offering these offline is phase 2 (§21.6).
- **Settings, notices, export and import, an expense's history.** Each says so offline, and changes nothing.
- **On iPhone, sync happens only while Tally is open.** Safari has no Background Sync.
- **A browser can evict storage.** Persistent storage is requested (`navigator.storage.persist()`); unsent changes could still be lost if it evicts.
- **A shared computer** holds a signed-in person's groups until they sign out.

### 11.7 First load, sign-out and an ended session

As Tusk's §8.5: the first load pulls each group's snapshot in pages, newest first; later loads paint from the device with no spinner; signing out
deletes the device's database after trying to send the outbox, and warns if it cannot; a session that ended elsewhere is found at the next sync, which
shows sign-in and no data, and keeps the outbox for the same account.

### 11.8 Keeping the history small

Deleted comments are removed after 30 days; deleted expenses and payments stay (they are part of a group's record). A removed row leaves a tombstone of
id and `seq` so that devices learn of it. Tombstones and applied-mutation records go after 90 days; a device whose cursor is older gets a fresh
snapshot of that group, sending its outbox first.

## 12. Activity, notices and reminders

### 12.1 Activity

`activity` holds what happened in a group, written in the same transaction as the change: an expense or payment added, edited, deleted, restored or
replaced; a comment; someone added, invited, joined by invitation, left, removed or merged; a role changed; the group renamed, its currency or simplify
debts changed, closed or reopened. Each line is described in words by one pure function (`src/activity/describe.ts`), from the reader's point of view
("You paid 9.60 for Tram tickets", "Sam paid you 63.20").

- **A group's activity** is its _Activity_ view (§15.5); **`/activity`** is every group's together, filterable by group, person and kind (§15.8).
- Activity is read online; the group's expense list, built from the device's rows, is what shows offline.

### 12.2 Notices

Something a person is told: a row per person told, written in the change's transaction, **never for what a person did themselves.**

| Kind               | Who is told                                                                   |
| ------------------ | ----------------------------------------------------------------------------- |
| `added_to_group`   | The person added                                                              |
| `expense_added`    | Members in its split or among its payers                                      |
| `expense_changed`  | The same, for an edit, a delete or a restore                                  |
| `payment_recorded` | The other member of the payment, and the one paid if someone else recorded it |
| `comment`          | The expense's payers and members in its split, and earlier commenters         |
| `reminder`         | The person reminded (§12.4)                                                   |
| `invite_accepted`  | Whoever invited                                                               |
| `edit_replaced`    | The author of an edit replaced in a conflict (§11.4)                          |
| `group_closed`     | Every member, also on reopen                                                  |
| `owner_passed`     | A member who became an owner because the last one's account was deleted (§18) |

- **The bell,** left of the avatar, as Tusk's §16: the unread count up to "99+", `NotificationsPanel` with the latest, each opening where it points.
  **`/notifications`** is the whole list, by day. Read is per notice, plus "Mark all read" (`inbox_seen_at`); dismissed is shown nowhere.
- **A notice the person can no longer see** (they left the group) is not shown. Kept 90 days, at most the latest 500 a person.
- **The unread count shows offline** as last synced.

### 12.3 Delivery

The bell in Tally always. Beyond it, per kind and per channel, in Settings (`notice_pref`), with defaults:

| Channel            | Alone                         | Hosted, person linked to core                           | Default on for                                  |
| ------------------ | ----------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| **Email**          | Tally's mail (`TALLY_SMTP_*`) | Core's email (`email:send`), or Tally's if not granted  | `added_to_group`, `reminder`, `invite_accepted` |
| **Core's bell**    | —                             | `notifications:send`, a link back to the notice's place | Every kind that is on                           |
| **Push** (phase 2) | Web Push (§21.4)              | Web Push                                                | Designed now: a channel in the same table       |

- **Mail is sent in the background** through `mail_outbox`: a row written in the change's transaction, claimed by the mail job, retried with backoff,
  and never logged with its address or content. Invitations (§6.3) go the same way.
- **To a placeholder,** only email is possible, and only an invitation or a reminder is sent (§12.4).
- **With no channel available** (no mail set up, no core), the bell is the only channel and Settings says so. Nothing fails for it.
- Each send to core carries a `key`, so a repeat within a day is one send; `NotSupportedError` or no core sends nothing and changes nothing else.

### 12.4 Reminders

**Remind** appears beside someone who owes the person, on Home, a group's balances and the person's page.

- The server re-derives the debt (pairwise or simplified, by the group's setting) and refuses unless that person owes the one reminding, in that group.
- **Once a day** per (who reminds, who is reminded, group), held in `reminder`, checked by the server.
- The reminder says how much, in which group, from whom, with a link. An account gets a notice (and email by default); a placeholder with an email
  gets an email that includes their live invitation; a placeholder without one cannot be reminded, and the button says "Invite Sam to remind them".

## 13. Insights

Pure functions in `src/insights/` over the device's rows, so they work offline. **Spending is a person's share,** not what they paid: buying dinner
for four is a quarter of it spent. Every figure is per currency, never converted.

- **`/insights`**, the person's own, across their groups: spending by category for a month (with a month picker), spending by month for the last 12
  months, and spending by group.
- **A group's Insights view** (§15.5): the group's total spending by category and by month, and each member's share of it.
- **Charts** come from `@sovereignfs/ui`, built there first (§15.10), each with a table of the same figures beside it, for a screen reader and for
  anyone who prefers numbers.

## 14. Sign-in and core

### 14.1 Sign-in

**As Tusk's §6, with `TALLY_` for `TUSK_`, and two additions** (§6.4, §14.2): better-auth in a store of its own; local accounts (password, passkey,
authenticator app with backup codes) when `TALLY_AUTH_LOCAL=1`; a Sovereign core through `genericOAuth` with PKCE when `TALLY_CORE_*` are set;
either or both, from one image, and **both may be on when hosted.** Email is verified and passwords reset only with mail set up. A person is their
better-auth user id.

### 14.2 Persons and identities

- Making an account makes its person (§6.1), or **claims one:** through an invitation (§6.3), or, signing in through core, the placeholder linked to
  that `sub` from the directory (§6.2). A `sub` is identity; an email is never matched to an account or a person at sign-in.
- **No implicit linking**, as Tusk's: a core login whose email is a local account's is refused until the person links the two from a signed-in session,
  and only when the addresses match. Unlinking can never remove an account's last way in.
- Name and email from core are copied when the account is made and not overwritten after; the person changes their own in Settings.

### 14.3 Core's notices

Back-channel logout at `/api/sovereign/backchannel-logout` ends every session of the person; account deleted at `/api/sovereign/account-deleted` runs
`People.deletePerson` (§18) and answers `200` only once done. Both checked by the SDK (`verifyLogoutToken`, `verifyAccountDeletedToken`), a replayed
`jti` refused after a restart (`notice_seen`), a bounded form, one rate limit, 404 where core is not set. Copied from Tusk.

### 14.4 The manifest

```json
{
  "manifest": 2,
  "prefix": "tally",
  "name": "Tally",
  "description": "Split shared expenses with the people you share them with, and see who owes whom",
  "icon": "/icons/icon.svg",
  "port": 3004,
  "health": "/api/health",
  "launch": "/",
  "signIn": {
    "redirect": ["/api/auth/callback/sovereign"],
    "backChannel": "/api/sovereign/backchannel-logout",
    "accountDeleted": "/api/sovereign/account-deleted",
    "scopes": ["openid", "profile", "email", "offline_access", "directory"]
  },
  "database": true,
  "generate": ["TALLY_AUTH_SECRET", { "name": "TALLY_ENCRYPTION_KEY", "bytes": 32 }],
  "core": ">=0.57.0 <1.0.0"
}
```

- **`directory` and `offline_access`** are for finding people in core's directory, which the SDK does as the person (`sv.as({ sub })`) with their
  refresh token. That token is a credential, so it is kept only through envelope encryption under `TALLY_ENCRYPTION_KEY` (`src/crypto/`), in the SDK's
  `tokenStore`. How better-auth's `genericOAuth` hands the refresh token to that store is checked in the task that builds it (11.2, §22); if a core
  refuses the scopes, or the person did not grant them, adding people works exactly as alone.
- **The `core` floor** is raised, if needed, to the first release that shipped the directory scope and the app scopes Tally calls, checked against
  core's changelog in that task.
- `pooling` is not set; `data` is not needed until receipts (§21.1).

### 14.5 Core's services

| What                            | Hosted                                                              | Alone                    |
| ------------------------------- | ------------------------------------------------------------------- | ------------------------ |
| Sign-in                         | Core, and local accounts if `TALLY_AUTH_LOCAL=1`                    | Local accounts           |
| Finding people                  | Tally's own, and core's directory (§6.2)                            | Tally's own              |
| Notices                         | Tally's bell, and core's bell (`notifications:send`)                | Tally's bell             |
| Email                           | Core's (`email:send`) for linked accounts; Tally's for placeholders | Tally's (`TALLY_SMTP_*`) |
| Export, import, account deleted | A line on the person's activity page (`activity:write`)             | Nothing                  |

The operator grants the three app scopes when hosting. **An instance without SMTP for Tally** can still invite by link; Settings and the invitation
dialog say email to new people is not set up.

## 15. Interface

Designed anew; the plugin's three-column layout is not carried over.

### 15.1 Principles

`@sovereignfs/ui` throughout, imported directly; `--sv-*` tokens only; Hanken Grotesk served by the app. **Amounts** are tabular figures with their
currency, and owed or owing is said in words, never by colour alone. **Screens paint from the device** (§11.1), so after the first load nothing shows a
spinner to see what was already seen; a screen that needs the server (activity, notices, settings) shows a skeleton. Every surface has an empty state
that says what to do next. An entry not yet synced shows a small clock mark and nothing more.

### 15.2 The shell

Two rows, as Tusk's §17.2: the header, and the sidebar beside the content.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ☰  tally.                                                        (bell) (avatar) │
├────────────────────────┬──────────────────────────────────────────────────────┤
│ [ + Add expense ]      │                                                      │
│ ⌂ Home                 │                                                      │
│ ◐ People               │                      content                         │
│ ≋ Activity             │                                                      │
│ ▥ Insights             │                                                      │
│                        │                                                      │
│ GROUPS                 │                                                      │
│  ● Lisbon     owes 63  │                                                      │
│  ● Roomies   owed 120  │                                                      │
│  ○ Ski 2025    closed  │                                                      │
│  + New group           │                                                      │
│                    ⇤   │                                                      │
└────────────────────────┴──────────────────────────────────────────────────────┘
```

- **Header:** the sidebar's toggle and the wordmark on the left; the bell and the avatar on the right. The avatar opens `UserMenu`: name and email,
  Settings, Notifications, Sign out, and a way back to core when one is set. Couldn't sync, when anything is there, shows as a mark on the avatar and an
  entry in its menu.
- **Sidebar:** _Add expense_ first, always one click away; Home, People, Activity, Insights; then **Groups**, open ones by latest activity with the
  group's dot and the person's balance in it, closed ones after, dimmed; _New group_ last. Full or a rail of icons, remembered on the device.

### 15.3 Screens and addresses

| Address                   | What                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/`                       | The landing page for a visitor; Home when signed in (§15.4)                                                  |
| `/groups`                 | Every group, open and closed, with balances (the phone's way in; on a wide screen, the sidebar has them too) |
| `/g/<id>`                 | A group (§15.5), its view in `?view=` (`expenses`, `balances`, `insights`, `activity`)                       |
| `/g/<id>/settings`        | The group's settings: details, people and invitations, roles, simplify debts, close, delete (§7)             |
| `/g/<id>/e/<id>`          | An expense: payers, split, comments, history (§15.6); `/g/<id>/p/<id>` a payment, the same                   |
| `/people`, `/people/<id>` | Everyone the person shares a group with; one person (§15.7)                                                  |
| `/activity`               | Every group's activity, with filters in the query (§15.8)                                                    |
| `/insights`               | The person's spending (§13)                                                                                  |
| `/notifications`          | Every notice (§12.2)                                                                                         |
| `/settings`               | Settings (§16)                                                                                               |
| `/invite/<token>`         | An invitation (§6.3), for anyone                                                                             |
| `/sign-in`, `/sign-up`    | As Tusk's                                                                                                    |

The add-expense and record-payment sheets open over any page (`?add=expense`, `?add=payment`, with `&g=` to pre-fill the group), so that a link and
the back button behave.

### 15.4 Home

Where the person stands, then what to do about it:

1. **Your balance:** "You are owed" and "You owe", per currency, the primary currency first and largest.
2. **To settle:** every person with a balance against them, largest first, each with the amount, the groups it comes from, and **Settle up** (they
   owe) or **Remind** (owed to them).
3. **Groups:** the open groups with a balance, as tiles with the dot, the members' avatars (`AvatarStack`) and the person's balance.
4. **Recently:** the last ten expenses and payments involving them, from the device.

A new person with no group sees one empty state: _Create your first group_, and, if they arrived through an invitation, nothing at all, since they
landed in that group.

### 15.5 A group

- **Header:** the dot and name, the members' avatars, the person's balance in it, and three actions: **Add expense**, **Settle up**, and the gear (for
  everyone: members see the people list and can add people; owners see the rest). A closed group says so under the name, and its actions are gone.
- **Expenses** (default): the list by month, newest first, each row the category's icon, the description, who paid, the person's part of it ("you
  borrowed 21.00", "you lent 63.00", "not involved"), the date, and the clock mark if unsynced. Payments are rows too ("Sam paid Kasun 63.20").
  Searchable by description and note; filterable by person and category; deleted ones behind a toggle. Paints from the device.
- **Balances:** each member's balance per currency (`BalanceChip`), then who owes whom (§10.2, §10.3), each pair with Settle up or Remind, and a line
  saying whether debts are simplified, with a link to change it for an owner.
- **Insights:** §13 for this group.
- **Activity:** §12.1 for this group.

On a wide screen, Balances also stands as a column beside Expenses (`SplitPane`); the address and the data are the same, only what is rendered forks.

### 15.6 An expense

The description, the amount and the date large; the category; who paid what; each member's share and how it was split; the note; then **Comments**,
with a field to add one; then **History**, each version in words with who and when, and a replaced version's **Restore this version**. Edit opens the
add sheet filled in; Delete and Restore are in its menu. A payment's page is the same, smaller.

### 15.7 A person

Their name and avatar (initials: no picture is loaded from elsewhere), "not on Tally yet" for a placeholder; the balance between the two per currency;
a breakdown by group; **Settle up** (§9) and **Remind** (§12.4); and the expenses and payments both took part in, newest first, across groups, each
with its group's name. For a placeholder the person added: **Invite**, and editing the name and email.

### 15.8 Activity

Every group's activity, newest first, grouped by day, each line in words with its group; filters for group, person and kind, in the query.

### 15.9 Adding an expense

The interaction everything else is built to make quick. `Sheet` on a wide screen, `Drawer` on a narrow one, the same content:

```
┌───────────────────────────────────────────────┐
│  Add expense                              ✕   │
│                                               │
│   € 84.00                                     │  ← the amount first, large, focused
│   Dinner at Ramiro                            │  ← then the description
│                                               │
│   in  [● Lisbon]   on  [Today]   as [🍽 Eating out] │
│   paid by  [you]                              │
│   split  [equally]  between  [everyone (3)]   │
│                                               │
│   Kasun 28.00 · Thulana 28.00 · Sam 28.00     │  ← the result, always shown
│   + Note                                      │
│                                [ Save ]       │
└───────────────────────────────────────────────┘
```

- **A sentence of choices.** Each bracketed word is a button that opens its choice in place: the group; the date; the category; who paid (one, or
  several with amounts, which must add up); and the split: the method (`SplitMethodSelector`) and the members (`MemberMultiSelect`), with an input per
  member for amounts, percentages (`CurrencyInput`, percentages as numbers) or shares (`QuantityStepper`).
- **The result is always shown,** with what is left to assign, so a split that does not add up says so before Save is pressed; Save is disabled until it
  does.
- **Defaults remembered per group on the device:** the last category, payer and split. A typical entry is the amount, a word, Enter.
- **Opened from a group,** the group is filled in; from anywhere else, the most recently used group, changeable first.
- **Enter saves; "Save and add another" keeps the group, date and split.** Saving closes the sheet at once: the expense is on the device (§11).
- The currency is the group's default, changeable from the amount's currency code.
- **Record a payment** is the same kind of sheet: who paid whom (pre-filled from Settle up), the amount, the group, the date, a note.

**Keyboard:** `N` adds an expense, `P` records a payment, `/` searches the current list, and `Esc` closes a sheet, wherever no field has focus.

### 15.10 Design system

Available and used: layouts, `Header`, `UserMenu`, `NotificationsPanel`, `Sheet`, `Drawer`, `Dialog`, `ConfirmDialog`, `Tabs`, `SegmentedControl`,
`SplitPane`, `CurrencyInput`, `SplitMethodSelector`, `MemberMultiSelect`, `QuantityStepper`, `BalanceChip`, `Combobox`, `DatePicker`, `Avatar`,
`StatusBadge`, `EmptyState`, `Toast`, `Menu`, `CopyButton`, `MobileFooter`, `MobileHeader`, `MobileAppsDrawer`, `Auth`.

**Missing, and built in `@sovereignfs/ui` in `sovereign` first, released, then used** (epic 14):

- **Charts:** a bar chart (spending by category, by group, by member) and a chart over time (spending by month), token-coloured, accessible with a
  table of the same data, no chart library loaded from elsewhere. Ledger needs the same, so they are designed for both.
- **`AvatarStack`:** overlapping avatars with "+N".
- **A floating action button** for the phone's Add.
- **`MoneyInput`** (`CurrencyInput` bound to a currency's decimals, with the code) and **a currency picker** (searchable, with chosen currencies
  first). Ledger planned them as its own; with two apps needing them, they belong in the design system.

The sentence of choices (§15.9) is Tally's own composition of `Button`, `Popover` and the parts above, unless another app needs it.

### 15.11 Phone and PWA

**One responsive tree:** the same routes and decisions at every width, only rendering forked (the guide's rule).

- **`MobileFooter`:** Home and Groups left of the launcher, People and Activity right. **Add** is a floating button above it, opening the drawer.
  Insights, Notifications and Settings are in the avatar menu; the bell stays in the header.
- A group's views are tabs; an expense, a person and settings are full pages with a back link.
- **Installable as a PWA,** as Tusk's §17.9: the service worker keeps the shell by allow-list and the one shell page, which holds nothing of a person;
  with no network, a signed-in address (Home, a group, an expense, a person) is answered with the kept shell, which reads the device's store. **No data
  is ever in a cache;** it lives in IndexedDB, named per account and deleted at sign-out. Every other address offline gets a page saying it needs a
  connection. The worker also runs Background Sync (§11.3).

## 16. Settings

`/settings`, also from the avatar menu:

- **Profile:** name (which is the person's name everywhere, §6.1) and email; **primary currency** (pre-fills new groups, and orders figures in more than
  one currency; Tally never converts, and the setting says so).
- **Notifications:** each kind (§12.2) by channel (email, core's bell when hosted; Push in phase 2), with what is not available said plainly.
- **This device:** when it last synced, **Couldn't sync** (§11.5), and "Reset this device" (sends the outbox, then reloads every group).
- **Sign-in:** the account sections Tusk has: password, passkeys, two-factor, linking core.
- **Data:** export, import (§17), delete account (§18).

## 17. Export and import

- **Export:** one JSON file of what is the person's to take: their profile and settings, and every group they are in, whole (members by name,
  expenses with payers, shares and comments, payments), since a group's record is what they share. Other people's emails are never in it. A `format`
  and `version` at the top; ids kept. Downloaded from Settings > Data, and noted on core's activity page when hosted.
- **Import** makes **new groups** from a file, with the importer as owner and every other member as a placeholder with their name and no email:
  history kept, nobody else joined without asking. Validated whole before anything is written, written in one transaction with new ids mapped
  consistently. A file from a newer version is refused with a sentence that says so.
- **A round trip is a test:** export, import into a second account, export again; the groups match but for ids, times and the members' kind.

## 18. Account deletion and signing out

**`People.deletePerson`** (`src/sovereign/people.ts`, as Tusk's) removes everything personal of an account and keeps only the name on the shared
record, so that the other members' numbers still add up. One routine, safe to run again; the `sub` link goes last.

- **Their person stays, as a name only:** `account_id`, email and `core_sub` cleared, marked deleted. Everywhere they appear, they are shown as "Sam
  (left Tally)". Their expenses, payments, shares and memberships stay, so every balance is unchanged; a member's balance with them can still be settled
  by recording a payment.
- **Their memberships end** where their balance is zero, as leaving would; where it is not, they stay a member, shown as left Tally, until it is.
- **A group where they were the only owner** passes to its longest-standing member with an account, who is told (`owner_passed`); **a group with no
  other account left** is deleted, with everything of it.
- **Their comments stay**, as text on the shared record, shown by their name (§24).
- **Removed:** notices for them, their notice preferences, reminders by and to them, invitations they made (revoked), placeholders they added that were
  in no group, their device subscriptions (phase 2), their stored core token, rate counters, mail queued to them, and better-auth's rows: passkeys,
  two-factor, sessions, sign-ins, and the account.

A test seeds one row of every table, for the person and for a second person sharing a group with them, and finds nothing personal of the first after
(the name aside), the second's groups intact and their balances unchanged. A new table that holds something of a person fails it until it is decided.

It is reached from **Settings > Data**, after the password or, for a Sovereign-only account, a fresh session, saying what goes and what stays; and from
**core's account-deleted notice** (§14.3), answered `200` only once done. The device's database is deleted; other devices find out at their next sync.

## 19. Data model and database

### 19.1 Database

**As Tusk's §23.1, with `TALLY_`:** `TALLY_DB_DIALECT` is `sqld` (default; namespaces `tally` and `tally_auth`), `sqlite` (`file:/data/tally.db`,
`tally_auth.db` beside it) or `postgres` (schemas `tally` and `tally_auth`). Drizzle, a schema and a migration set per dialect, generated and never
written by hand, applied at start-up under a lock; a parity test across dialects. Standard SQL, values bound; no `LISTEN/NOTIFY`, trigger, extension
or foreign key; **every deletion names what it deletes, in a transaction**, by `group_id` where it is a group's. Tests run on all three and read
`TALLY_TEST_*` only.

### 19.2 Representations

As Tusk's column vocabulary: ids are UUIDs, **made by the device for synced rows** (checked as UUIDs by the server, and refused if the id already
belongs to another group's row) and by the server otherwise; times `epochMs`; booleans the vocabulary's word; dates `YYYY-MM-DD`. **Money is a 64-bit
integer of minor units** (`bigint` on PostgreSQL, read as a `number` and checked to be a safe integer). A currency is a three-letter code.

### 19.3 Tables

Beyond better-auth's, in the auth store.

| Table                      | Columns                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `person`                   | `id`, `account_id` (unique, may be null), `core_sub` (unique, may be null), `name`, `email`, `added_by`, `claimed_at`, `deleted_at`, `created_at`, `updated_at`                                  |
| `grp`                      | `id`, `name`, `color`, `default_currency`, `simplify_debts`, `closed_at`, `seq`, `created_by`, `created_at`, `updated_at`                                                                        |
| `member`                   | `id`, `group_id`, `person_id`, `role` (`owner`, `member`, null for a placeholder), `added_by`, `joined_at`, `left_at`, `seq`                                                                     |
| `expense`                  | `id`, `group_id`, `description`, `amount`, `currency`, `date`, `category`, `note`, `method`, `version`, `created_by`, `updated_by`, `deleted_at`, `seq`, `created_at`, `updated_at`              |
| `expense_payer`            | `expense_id`, `member_id` (the key), `group_id`, `amount`                                                                                                                                        |
| `expense_share`            | `expense_id`, `member_id` (the key), `group_id`, `amount`, `units`                                                                                                                               |
| `payment`                  | `id`, `group_id`, `from_member_id`, `to_member_id`, `amount`, `currency`, `date`, `note`, `version`, `created_by`, `updated_by`, `deleted_at`, `seq`, `created_at`, `updated_at`                 |
| `revision`                 | `id`, `group_id`, `subject` (`expense`, `payment`), `subject_id`, `version`, `kind` (`created`, `edited`, `deleted`, `restored`, `replaced`), `snapshot` (JSON), `actor_person_id`, `created_at` |
| `comment`                  | `id`, `group_id`, `subject`, `subject_id`, `author_person_id`, `body`, `deleted_at`, `seq`, `created_at`                                                                                         |
| `activity`                 | `id`, `group_id`, `actor_person_id`, `kind`, `subject_id`, `details` (JSON), `created_at`                                                                                                        |
| `invitation`               | `id`, `group_id`, `person_id` (the placeholder), `token_hash` (unique), `email`, `created_by`, `expires_at`, `sent_at`, `accepted_by`, `accepted_at`, `revoked_at`                               |
| `notice`                   | `id`, `account_id`, `kind`, `actor_person_id`, `group_id`, `subject_id`, `details`, `read_at`, `dismissed_at`, `created_at`                                                                      |
| `notice_pref`              | `account_id`, `kind`, `channel` (the key), `on`                                                                                                                                                  |
| `reminder`                 | `group_id`, `from_person_id`, `to_person_id`, `day` (the key), `sent_at`                                                                                                                         |
| `account_settings`         | `account_id` (the key), `primary_currency`, `inbox_seen_at`, `created_at`, `updated_at`                                                                                                          |
| `mail_outbox`              | `id`, `account_id` or `to_address`, `template`, `data` (JSON), `attempts`, `next_attempt_at`, `sent_at`, `failure_kind`, `created_at`                                                            |
| `applied_mutation`         | `account_id`, `id`, `group_id`, when (§11.8)                                                                                                                                                     |
| `tombstone`                | `table`, `id`, `group_id`, `seq`, when (§11.8)                                                                                                                                                   |
| `credential`               | As Tusk's: core refresh tokens under envelope encryption (§14.4)                                                                                                                                 |
| `notice_seen`              | A core notice's `jti` and when (§14.3)                                                                                                                                                           |
| `job_claim`, `rate_bucket` | As Tusk's                                                                                                                                                                                        |

Indexes follow the queries: members by person (an account's groups) and by group; expenses and payments by `(group_id, seq)` for pull and by
`(group_id, date)`; payers and shares by expense; revisions and comments by subject; activity by group and time; notices by account and time;
invitations by placeholder; the mail outbox by `next_attempt_at`.

**The device's store** holds, per group, the group, its members with their names, expenses with payers and shares, payments and comments, and per
account the cursors, the outbox, Couldn't sync, the last-synced unread count, and the defaults remembered for the add sheet. Nothing else.

## 20. Security, deployment, testing

### Security

As Tusk's §24: a strict CSP with a per-request nonce, `connect-src 'self'`, no `'unsafe-inline'`; nothing third-party loads; what people write is
rendered as text, never as HTML. **Logs hold no amounts, descriptions, notes, comments, names or addresses:** an id and a kind of failure. Every route,
operation and mutation finds the session and carries the permission in its statement (§5.2); a route that changes something checks `Origin`. An
invitation token is random, stored hashed, compared in constant time, and its page reveals the group's name and the inviter's only. **Rate limits:**
adding people by email, invitations and resends, reminders, sign-up, sync requests. A security review of phase 1 is written up before its release,
with access (§5.2), sync (§11.5), invitations (§6.3) and deletion (§18) at its centre.

### Licence

AGPL-3.0-or-later, since it bundles `@sovereignfs/ui`.

### Deployment

One image (Debian, for libSQL), not root, on port 3004, and three Compose setups in `deploy/`:

```bash
docker run -v tally:/data -e TALLY_DB_DIALECT=sqlite -e TALLY_SQLITE_URL=file:/data/tally.db \
  -e TALLY_URL=https://tally.example.com -e TALLY_AUTH_LOCAL=1 -e TALLY_AUTH_SECRET=… -e TALLY_ENCRYPTION_KEY=… ghcr.io/sovereignfs/tally
```

- **Settings** are the shared names of `contracts/env.md` (with `AUTH_SIGNUP`'s `invite`, §6.4) and one of Tally's own: `TALLY_WORKER`. Each declared
  once in `@sovereignfs/config`, in `.env.example` and in the README.
- **Hosted:** `sv app add tally`, from the manifest; the operator grants the three app scopes, and sets `TALLY_SMTP_*` in `suite.yml` to email people
  who are not on the instance, and `TALLY_AUTH_LOCAL=1` to let them make an account.
- **Releases** as Tusk's: `scripts/release.sh`, a `vX.Y.Z` tag publishes amd64 and arm64 to `ghcr.io`; a patch has no migration.
- `/api/health` answers `200` once the database is ready.

### Testing

- **Vitest, pure:** splitting and rounding for every method and currency decimals, balances, pairwise debts, simplification, insights and the activity's
  words, with hand-worked fixtures.
- **Properties:** random sequences of expenses, payments, edits, deletes and restores in several currencies, after which every expense's payers and
  shares add up, every group's balances add up to zero per currency, every member's pairwise debts add up to their balance, applying the suggested
  payments settles everyone, and the same rows give the same results in any order of arrival.
- **Sync:** two devices editing one expense, an edit against a delete, a mutation sent twice, a lost answer, a refusal for a closed group and for a
  removed member (landing in Couldn't sync), a stale cursor, a group left between syncs.
- **Access:** every route, operation and mutation called as a second person, expecting not found (§5.2).
- **The data layer** on sqld, a `file:` database and PostgreSQL; **jobs** run twice and from two processes, sending once.
- **Sign-in** against the fake Sovereign, **notices** against `createFakeCore` from `@sovereignfs/sdk/testing`, **mail** against a fake SMTP server.
- **Playwright** in Chromium and WebKit, at desktop and phone widths: create a group, invite, accept, add with each split, settle up, comment, and an
  expense added with the network off (`context.setOffline`) that a second browser sees once back online.
- **A seed** (`pnpm seed`): a few accounts, a placeholder with a live invitation, a group in two currencies with every split method, several payers, a
  conflict in history, comments, payments, a closed group, and simplify debts on and off.

## 21. Phase 2, in outline

### 21.1 Receipts

An image or PDF on an expense, stored **by Tally itself**, never through core: under a `data` path (`/data/receipts`, declared in the manifest) or in
the database, decided then. Size-limited, judged by its bytes, served only to the group's members, removed with the expense's group and in deletion.
Uploaded online; offline, queued as a file in the device's store.

### 21.2 Currency conversion

Settling a balance in another currency, at a rate the person types or one the server fetched (as Ledger's §9.2 does, from Frankfurter by currency code
only). Balances stay per currency; a conversion is a payment in one currency that settles a debt in another, recorded with both amounts.

### 21.3 Recurring expenses

Rent every month: a rule (Tusk's rule format, as Ledger copies it) that posts an expense on its day, idempotent on `(rule, occurrence)`.

### 21.4 Push notifications

Web Push, with its keys generated once by the instance (`generate`: `TALLY_VAPID_PRIVATE_KEY`; the public key derived) or the operator's: a
subscription per device in `push_subscription`, the channel already in `notice_pref` (§12.3), sent from the mail job's sibling with the same claims.
Browser push services cost nothing. On iPhone, only once Tally is added to the home screen; Settings says so.

### 21.5 Import from Splitwise

Splitwise's CSV export into new groups, as import does (§17): members as placeholders.

### 21.6 People and invitations offline

Creating a group and adding placeholders offline, as mutations, with invitations sent once synced.

### 21.7 Live updates

Server-sent events per group in place of the 30-second pull (§11.3).

## 22. Not settled in the platform

- **`AUTH_SIGNUP`'s `invite`** (§6.4) is not in `contracts/env.md`; it is added there first, for every app, as a task in `sovereign` (14.5). Until it
  lands, Tally does not ship it.
- **The directory as a person** (§14.4) needs the SDK's `tokenStore` fed from better-auth's `genericOAuth`; whether that works without a change to the
  SDK is checked in 11.2, and a gap is raised in `sovereign`.
- The kit of research 0004 is not published, so the infrastructure is copied from Tusk (§5.1); when the kit lands, Tally adopts it in a task of its own.
- `AUTH_LOCAL` accepts `1` and `true` until `contracts/env.md` and the apps agree (building-an-app §15).
- **Port 3004** is added to building-an-app §2's table in `sovereign`, beside Ledger's 3003.

## 23. Open questions

None. The four left open by the first draft were settled on 2026-11-09 and are in §24.

## 24. Decision log

| Date       | Decision                                                                                                               | Why                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 2026-11-09 | An app of its own, Tusk's shape: local and core sign-in, three database forms; **every feature works alone**           | The owner's golden rule for every app: core is optional, and an app never fully depends on it       |
| 2026-11-09 | Name **Tally**, prefix `tally`, port 3004                                                                              | Kept from the plugin; 3003 is Ledger's                                                              |
| 2026-11-09 | **Tally keeps its own `person`**, with name and email, for accounts and placeholders                                   | People with no account, and names that outlive an account; no dependence on core for who someone is |
| 2026-11-09 | **Placeholders and invitations** in place of guests; a claim takes over the placeholder's history                      | Splitwise's way in for people outside, and the plugin's open question of claiming a guest           |
| 2026-11-09 | Local sign-up **by invitation** by default, through `TALLY_AUTH_SIGNUP`                                                | People must be able to join a group without opening the server to everyone; changeable by setting   |
| 2026-11-09 | **Core sign-in and local accounts may both be on when hosted**                                                         | People not on the instance can still join                                                           |
| 2026-11-09 | Mail through **Tally's own SMTP** alone; core's email for linked accounts when hosted                                  | It works alone; core is an addition                                                                 |
| 2026-11-09 | Deleting an account **keeps the name** and removes email and everything else personal                                  | The others' balances depend on the shared record                                                    |
| 2026-11-09 | **Offline first for expenses, payments and comments,** background sync with a counter per group; online for membership | Recording must never wait; a membership change must be decided at once                              |
| 2026-11-09 | An edit **replaces the whole expense,** later wins, the replaced version kept and its author told                      | Amounts and splits must add up; nothing anyone typed is lost                                        |
| 2026-11-09 | **Per-expense history** and **comments** in phase 1                                                                    | Conflicts need history; comments are what Splitwise people use                                      |
| 2026-11-09 | **No end-to-end encryption**                                                                                           | The server must check sums and send reminders                                                       |
| 2026-11-09 | **Never convert currencies** in phase 1                                                                                | Deferred to phase 2 (§21.2)                                                                         |
| 2026-11-09 | **Fixed categories**                                                                                                   | Enough for phase 1                                                                                  |
| 2026-11-09 | **Charts, `AvatarStack`, a floating button, `MoneyInput` and a currency picker** built in `@sovereignfs/ui` first      | The suite's design-system-first rule                                                                |
| 2026-11-09 | **Receipts in phase 2,** stored by Tally                                                                               | Scope; file storage is the app's concern, never core's                                              |
| 2026-11-09 | **Push planned, not in the MVP**                                                                                       | Scope; the channel is designed now so that adding it changes nothing else                           |
| 2026-11-09 | Interface **designed anew**                                                                                            | The owner's direction                                                                               |
| 2026-11-09 | Start and end dates of a group **dropped**                                                                             | Nothing used them                                                                                   |
| 2026-11-09 | **No migration** from the plugin                                                                                       | No data needs to move                                                                               |
| 2026-11-09 | A deleted account's **comments stay**, as text by their name                                                           | Part of the shared record, as Tusk keeps comments                                                   |
| 2026-11-09 | **Any member can add people** and invite; removing and roles are owners'                                               | Splitwise's way; adding someone to a trip should not wait for an owner                              |
| 2026-11-09 | An invitation is **claimed by whoever holds the link**, whatever address it was sent to                                | A link sent through a chat must work; it is single-use, expiring, and the inviter is told           |
| 2026-11-09 | **Limits:** 50 members a group, 200 groups an account                                                                  | Accepted as a start; changed by a task if real use needs it                                         |
