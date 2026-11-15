# Security review, phase 1

Reviewed on 2026-11-15, before release 0.1.0, against `DESIGN.md` §20 and the rules of `AGENTS.md`. Each area says what was looked at, how, what was
found, and what was decided. **No finding of high severity is open.** Four were fixed in the same change as this review (marked _fixed_); three
are recorded with a decision (marked _decided_).

Severity: **high**, someone can read or change what is not theirs, or take an account; **medium**, abuse that costs someone else, or a secret kept
more widely than it needs to be; **low**, hardening.

## 1. Access in every statement (§5.2)

- **Looked at:** `src/access/routes.ts` against every route file (the access tests fail for a route that is not listed); every operation in
  `src/groups/ops.ts` (`OPERATIONS`), the notices, import, export and settings routes added since Milestone F; whether each finds the session first,
  checks `Origin` on a write (`accountRoute`), and holds the membership or the owner's role in the statement that reads or writes.
- **Found:** the routes not for a signed-in account are the landing page, sign-in pages, an invitation's page, health, the shell and its service
  worker, and core's two notice routes, whose signed token is their credential (§6). Every other route is an account's, through `accountRoute`.
  Group operations move the group's `seq` in a statement that carries `activeMemberOf` or `ownerOf` (`moveSeq`, `createGroup`), and the merge,
  reminder and lifecycle operations name the group's members in the same statements. Notices name the account and the group's active membership in
  every statement. Directory search is the account's own (its `sub`); import makes new groups owned by the importer and touches no row already there.
  Each of these has a test calling it as a second person.
- **Decided:** nothing to change.

## 2. Sync, and what the server checks again (§11.5)

- **Looked at:** `src/sync/apply.ts`, the one write path, and the two other writers in its file (`mergeMemberRows`, `importGroupRows`).
- **Found:** every mutation is checked again on the server against the stored rows (membership, the group open, sealed form and epoch, amounts,
  currencies, dates, payers adding up, shares exactly what the split gives), in one transaction with the permission in the statement; a replay writes
  nothing; a row of another group reads as not found. The merge and the import write only rows that their callers checked as a change is checked,
  inside a transaction that holds the owner (merge) or makes the group (import). The property tests pass.
- **Decided:** nothing to change.

## 3. Invitations and claiming (§6.3)

- **Looked at:** `src/invites/store.ts`, `ops.ts`, `api.ts`, `/invite/[token]`.
- **Found:** a token is 32 random bytes kept only as its SHA-256, compared with `timingSafeEqual`, single use (the statement that marks it holds that it
  is live), 14 days, revocable, one live per placeholder; every invalid link shows the same page; `Referrer-Policy: no-referrer` keeps a link out of
  referrers; the key in a copied link's fragment never reaches the server (checked in Playwright's request log); the wrap it opens is deleted on use,
  revocation and expiry.
- **_Fixed_ (medium): making an invitation mailed it every time.** "Resend" was held to once an hour, but "New link" mailed again each time, so a
  member could flood a placeholder's address. Now an invitation email goes to a person at most once an hour, however many links are made; the screen
  says when a new link was not mailed (`createInvitationIn`, tested).

## 4. Who sees an email address (§6.1)

- **Looked at:** every answer that carries a person: `readGroup` (through `viewPerson`), `member.add`, directory search, notices, activity,
  the export, the mail templates.
- **Found:** answers go through `viewPerson` (`src/people/visibility.ts`); the device's store holds names only; directory search returns names and
  `sub`s; notices and activity carry ids; the export holds only the person's own address (tested); no mail names a group or another person's address.
- **Decided:** nothing to change.

## 5. Deletion (§18)

- **Looked at:** `src/sovereign/people.ts` and its test, which seeds a row in every table and fails for a table in none of its lists; core's
  account-deleted notice.
- **Found:** everything personal goes, the name stays on the shared record, and it is safe to run twice; the stored core token, notices, choices and
  credentials added since are in the lists.
- **_Fixed_ (low, found by the development seed, 13.1):** a deleted person's name was kept even when no group showed it any more; now the person goes
  once no membership points at it.

## 6. Encryption (§5.3)

- **Looked at:** granting group keys (`src/keys/groups.ts`, `grants.ts`), the copied link's fragment, and whether sealed text is ever in plain text in
  a table, a log or a mail.
- **Found:** a group's name, descriptions, notes and comments are sealed on the device and stored only sealed; the server never holds a key that opens
  them (it stores wraps to account keys and to secrets it never sees). The export is made in the browser and the import is sealed there, so neither
  sends text in the clear. Mail and core's bell carry who, a figure and links only (tested for notices, reminders and invitations). Names of people
  are plain, by design (§6.1).
- **_Decided_ (low): a person's name, an amount, a currency, a category and a date are not sealed.** The server needs them for balances, reminders and
  notices; the design says so, and Tally is never called "zero-knowledge".

## 7. Content-Security-Policy and headers

- **Looked at:** `src/security/csp.ts`, `proxy.ts`, `next.config.ts`.
- **Found:** every page has a nonce of its own and `script-src 'self' 'nonce-…' 'strict-dynamic'`, no `unsafe-inline` for scripts (tested for every
  request), `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, `base-uri 'self'`; `nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a closed `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, and HSTS over https.
  The only `dangerouslySetInnerHTML` is the static theme script, under the nonce. What people write is rendered as text.
- **Decided:** nothing to change.

## 8. Logs

- **Looked at:** every `console.*` in the app's code, the job runner, the mail outbox and core's notices.
- **Found:** logs say an id and a kind of failure (`kindOf`, an error's name and code), never a message, an amount, a name, an address or a token.
  The database line names the host and the database, never the password. At start-up, a database that cannot be used is reported with the driver's
  message, for the operator.
- **_Decided_ (low): the start-up message is the driver's own.** It is shown once, to the operator, and drivers do not put passwords in it.

## 9. Rate limits

- **Looked at:** sign-in, sign-up and password reset (better-auth, counted in the database), adding by email, directory search, reminders, invitation
  mail, core's notices, import, and the export note.
- **Found:** each is limited, per account or per address as it should be, and counted in the database so that it holds across processes.
- **_Fixed_ (medium): import had no limit,** and one request could carry a 32 MB body of up to 100 groups of 20,000 rows each. Now an import is refused
  over 50,000 rows in all, and an account may import ten times an hour (tested).
- **_Fixed_ (low): the export note had no limit;** each call wrote a line to core's activity page. Now ten an hour.

## 10. Core's refresh token (§14.4)

- **Looked at:** how it reaches Tally (`onCoreToken`), where it rests, and the SDK's token store.
- **Found:** it is sealed under the instance key in `credential`, written only by `src/crypto/credentials.ts`, stored only in place of the token it
  replaces, refreshed one process at a time, never logged, in an error or in the browser, and deleted with the account.
- **_Fixed_ (low): better-auth kept its own copy as well,** encrypted under the sign-in secret, which went stale at the first rotation and would have
  looked like theft to core if anything ever sent it. Now better-auth's copy is cleared once Tally has sealed its own, so the token rests in one place
  (tested).

## What is left for later

- An account that comes in through core has no unlock-only passkey offered on its first device yet (§5.3); its second device stays locked until another
  device, the recovery key or a fresh start unlocks it. This is a gap in usability, not in security: nothing is readable that should not be.
- Two rarer flakes of the phone browser tests remain unexplained (recorded with the fix for the common one). They are in the tests, not the app.
