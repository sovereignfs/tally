# Epic 15: Encryption

## Status

📋 Planned.

## Overview

What people write in a group (its name, descriptions, notes, comments) is sealed on the members' devices under the group's key, and the server holds
only ciphertext of it; the figures stay readable so that the server remains the referee. Nobody handles a key: each account has one, made in the
browser, and **a new device unlocks with the same password or passkey that signs it in**, with nobody else online; adders unlock new members; another
device and a recovery key are the fallbacks (`DESIGN.md` §5.3). **It is designed for Tally and copies nothing:** WebCrypto for everything but
Argon2id, HPKE for wraps, one sealed blob per row. Tally is never described as "zero-knowledge": its figures are readable by design.

## Related

[`DESIGN.md`](../../DESIGN.md) §5.3, §6.3, §11.2, §11.3, §12.2, §14.1, §17, §18, §19.3, §21.1 · RFC 9180 (HPKE) · RFC 9106 (Argon2)

## Tasks

#### ✅ 15.1 — The cipher

**Goal:** the primitives every sealed row and every key goes through, pure and tested. **Design:** §5.3. **Depends on:** 1.2.

**Technical:** `src/cipher/`, written for Tally on WebCrypto: `seal` (a row's sealed JSON, padded to 32 bytes, AES-256-GCM under a group key with
`["tally/sealed/1", group, table, row, epoch]` as authenticated data, the form `s1.<epoch>.<base64url>`); `hpke` (RFC 9180 base mode, X25519,
HKDF-SHA-256, AES-256-GCM, for wrapping to a public key); `secret-wrap` (AES-256-GCM under an HKDF-derived key, for the password, a PRF output, the
recovery code and an invitation's secret); `password` (Argon2id, 64 MiB, 3 passes, parallelism 4, salted with a hash of the instance's address and the
email in lower case, 64 bytes split into the sign-in value and the unwrapping value; the protocol version carries the parameters); `prf` (a WebAuthn PRF
output into a wrapping key); `recovery` (128 random bits as a code to copy, download or print, with a QR made in the browser, read back forgivingly:
case, spaces, dashes); `vault` (keys kept in IndexedDB sealed under a non-extractable AES key made per device); errors that tell a wrong key from a
damaged value. One library, an Argon2id implementation, pinned exactly; if it is WebAssembly, 1.7 adds `wasm-unsafe-eval` to the CSP and says so. Pure,
run in the browser and in Vitest, imported by nothing on the server but the form checks.

**Accepts when:** a sealed row opens only with its own group, table, row and epoch, and a tampered one is refused; `hpke` passes RFC 9180's test
vectors for its suite; a wrap opens only with its key, and a wrong key is told apart from a damaged value; two texts whose lengths fall in one bucket
seal to the same length; the two password outputs differ and neither gives the other; a recovery code survives being retyped
with spaces and lower case; Argon2id takes under a second on a mid-range phone with the chosen parameters; the module imports nothing from the server.

**Done as:** `src/cipher/`, Tally's own on WebCrypto: `bytes` (base64url with one form per value, hex, I2OSP), `errors` (`malformed`, `wrong_key`,
`tampered`, `unsupported`), `hpke` (RFC 9180 base mode, single-shot; HKDF built from HMAC, since HPKE labels Extract and Expand apart), `seal`
(`s1.<epoch>.<…>`, padded to 32 bytes), `wrap` (`h1.` to a public key, `w1.` to a secret, each to a binding), `password` (Argon2id from `hash-wasm`
4.13.0, exact-pinned, the one library), `prf`, `recovery` (Crockford base32 in groups of four, **with two check characters** so a typo is told apart
from another account's code), `vault` (IndexedDB per account, sealed under a non-extractable AES key per device). `hpke` matches RFC 9180's vectors for
X25519 with AES-128-GCM and AES-256-GCM on every intermediate value and the ciphertext (`hpke.vectors.json`, taken from the CFRG draft's
`test-vectors.json`). The policy gains `'wasm-unsafe-eval'` for Argon2id, Tusk's test that forbade it changed to allow exactly that, and a browser test
that WebAssembly compiles under the policy, which failed without it. Argon2id takes about 150 ms in Node here; a mid-range phone, at three to five
times slower, is estimated at 0.5–0.8 s and is measured in a browser with 2.1. **Left out:** the QR of the recovery code, which is 15.4's screen.

#### ✅ 15.2 — Account keys and unlocking

**Goal:** every account has a key, and every device it signs in on unlocks at once, unasked. **Design:** §5.3, §14.1, §16. **Depends on:** 15.1, 2.1.

**Technical:** `account_key` and `account_key_wrap`, and `src/keys/`; the account key made in the browser at sign-up and wrapped by the password's
unwrapping value (2.1 already sends the derived sign-in value), by each passkey's PRF where it has one, and stored; sign-in fetches the wraps after the
session exists and unwraps on the device, keeping the key non-extractable; changing the password re-wraps in the browser; adding a passkey adds a wrap,
removing one deletes it; for a Sovereign-only account, the one-time offer of a passkey kept for unlocking; the fallback: another signed-in device of the
account shows "Allow your new phone to open your groups?" and wraps the key to the new device's one-time key (`method` `device`, deleted once used);
failing every way, a new account key, replacing the old (`replaced_at`), a line in each group's activity, and its group keys re-wrapped by members'
devices (15.3); Settings > Devices and Unlocking; `People.deletePerson` removes the key and every wrap; in `src/access/routes.ts` with the
second-person test.

**Accepts when:** in Playwright, an account signs in with its password on a second browser while the first is closed, and reads every group's words on
first load; the same with a passkey that has PRF (a virtual authenticator); a password reset leaves the old wrap unopened and the fallback offered; a
second person can read no wrap of the first's; deleting a person leaves no key or wrap of theirs.

**Done as:** `account_key`, `account_key_wrap` and `key_request` (migration `0002_add_account_keys`); `src/keys/store.ts` (every statement names
the session's account; a key made once, `ON CONFLICT DO NOTHING`; one password and one recovery wrap, one per passkey; a replacement only from the
version a device saw; requests good ten minutes, five at most, allowed once), `src/keys/api.ts` and `/api/keys`, `/api/keys/wraps[/id]`,
`/api/keys/requests[/id]`. **The access layer is copied from Ledger** (`src/access/route.ts` as `accountRoute`, `body.ts`, `routes.ts` and its test,
`two-accounts.ts`, `route.test.ts`), its "book" made the account and its person; the routes test accepts a page guarded by a layout's
`requirePerson()`. In the browser, `src/keys/unlock.ts` (`AccountKeys`: `afterPassword`, `afterPasskey`, `askAnotherDevice`/`approve`/`decline`,
`putSecretWrap`/`unlockWithSecret` for 15.4, `startAfresh`, and `current`, which drops a key the server has replaced): **the sign-in and sign-up forms
unlock with the same Argon2id run that made the sign-in value**, and the passkey sign-in asks for PRF in the same tap (`after-sign-in.ts`).
`KeyGate` in the shell says nothing when unlocked, offers _Ask another device_ and _Start afresh_ when locked, and on an unlocked device asks _Allow
your new device…?_ (every thirty seconds while visible). Signing out deletes the vault, and an open vault now steps aside for that
(`onversionchange`), which a test showed hanging without it. Run here: 384 tests on sqld and a file, 383 on PostgreSQL; boot-check on each; 44
browser tests twice (a second browser signs in with the first closed and holds the key; a locked device is let in by another; sign-out leaves no
vault); the isolation test failed with an account condition taken out. The shared `signOut` helper waits for the sign-in page, and `gotoSignIn`
knows Chromium's word for an interrupted navigation. **Left out:** the passkey's PRF in a browser test, with the Settings that add a passkey (2.6);
the Sovereign-only passkey offer (2.3); Settings > Devices and Unlocking (2.6); the activity line of a replaced key (15.3, which has groups);
`People.deletePerson` removing these rows (2.5).

#### ✅ 15.3 — Group keys and granting

**Goal:** a group's key reaches every member's account, and nothing else's. **Design:** §5.3, §6.2, §11.3. **Depends on:** 15.2, 3.2.

**Technical:** `key_wrap`, `grp.key_epoch`; creating a group (3.2) carries the first epoch wrapped to the creator's account key; adding a person with an
account (8.2) carries the wrap to their account key, made by the adder's device, in the same operation; a grants exchange (`/api/keys`, folded into
`/api/sync` once 6.1 is in) answering the wraps the account lacks and the members whose account key lacks a wrap of an epoch the device holds (a
claimed placeholder, a replaced account key), and accepting a wrap only for an active member of that group from a device of one (the permission in the
statement); a group not yet unlocked shows its figures and "…" for its words with one line saying what will unlock it; sealing in the outbox deferred
until the key arrives; `grp`, `expense`, `payment` and `comment` carry `sealed` in place of their text columns from their first migration.

**Accepts when:** a member added by an adder reads the group's words on first load; a replaced account key is re-wrapped by another member's device
within one sync; a wrap for someone not in the group is refused as not found; a mutation recorded on a device before it was unlocked is sealed and
applied once the key arrives.

**Done as:** `key_wrap` and `grp.key_epoch` came with 3.2, whose creation already stores the creator's wrap. `src/keys/grants.ts` and
`GET`/`POST /api/keys/groups` (in `routes.ts`): the wraps an account has of its groups, and **the members its device should wrap for** (active, with an
account key, lacking a wrap of an epoch the device holds); a grant is stored only from an active member who holds that epoch, for an active member of
the same group with an account key, **all in the insert's own statement**, and otherwise counted as refused. Replacing an account key (15.2) now
deletes that account's group wraps, so its groups are wrapped to the new key by the other members' devices. In the browser, `src/keys/groups.ts`
(`GroupKeys`: `sync`, `keyFor`, `prepareGroup` (an id, the name sealed under epoch 1, the key wrapped to the account's own and kept in the vault first),
`sealName`, `openName`, which is undefined while a group is not unlocked here); the key gate runs the exchange at each of its looks. Run here: an
integration test of two devices (the browser's own code and crypto over the real routes and database): a new member's group opens at the next
exchange of another member's device with nobody doing anything, and again after their key is replaced; a grant for a non-member, from a non-member,
or of an epoch not held, is refused. 397 tests on sqld and a file, 396 on PostgreSQL; 44 browser tests. Planted faults (the receiver's membership
taken out of the insert; a replaced key's wraps kept) each failed their test. **Left out:** the "…" of a group not yet unlocked, which is the screens'
(7.1); sealing in the outbox once the key arrives, which is the outbox's (6.2); adding a person carrying the adder's wrap (8.2); the activity line of a
replaced key (5.4).

#### ✅ 15.4 — The recovery key

**Goal:** a last way in, offered and never required. **Design:** §5.3, §16. **Depends on:** 15.2.

**Technical:** a wrap of the account key under the recovery code (`method` `recovery`); offered once after sign-up (copy, download, print, with a QR)
and skippable; Settings > Recovery key shows whether it was saved, makes a new one (replacing the wrap) and explains it in two sentences; on a device
that is waiting, "Use your recovery key" unlocks the account key and so every group.

**Accepts when:** after a password reset, with no other device and no passkey, the code alone unlocks every group; a replaced code unlocks nothing;
skipping it leaves every feature working.

**Done as:** `src/keys/RecoveryKeyOffer.tsx`: the code (15.1's, with its two check characters) to copy (`CopyButton`), download as a text file or
print, with a QR code drawn by `qrcode.react`'s `QRCodeSVG` as Tusk's and Ledger's two-factor panels draw theirs (inline, nothing fetched), and a
sentence on what it is for; **the wrap is made only on "I have kept it"**, so _Not now_ leaves nothing. It is offered once, right after sign-up (the
sign-up form sets a session flag the key gate reads, while the account has no recovery wrap). A locked device's notice now offers _Use your recovery
key_: the code, read forgivingly, unlocks the account key and so every group, and a code that is not one is told apart from one that is not this
account's. The e2e helper `ensureAccount` skips the offer, as a person may. Run here: 46 browser tests in Chromium and WebKit, twice (the offer gives a
code; a device the password cannot open is unlocked by it typed in lower case with spaces; a wrong code is said); the unlocking itself is 15.2's unit
test. The browser test failed with the wrap not made. **Left out:** Settings > Recovery key, which shows whether one is kept and makes a new one
(2.6, with this same offer).

#### 📋 15.5 — An invitation link that carries the key

**Goal:** someone opening a copied invitation reads the group at once. **Design:** §5.3, §6.3. **Depends on:** 8.3, 15.3.

**Technical:** the inviter's device makes the link's secret and wraps the group key to it (`invitation.key_wrap`); the copied link is
`/invite/<token>#<secret>`, offered first in the invitation dialog, and the emailed one has no fragment; the invitation page opens the group's name from
the fragment in the browser, or names the inviter alone; claiming with a fragment wraps the key to the claimer's account key in the claim; revoking,
expiring or using the invitation deletes its wrap.

**Accepts when:** a copied link opens the group's words on first load; an emailed link's group is unlocked by a member's device at its next sync; no
request to the server carries the fragment (checked in Playwright's request log); a used invitation's wrap is gone.

#### ✅ 15.6 — Rotating a group's key

**Goal:** someone who left cannot read what is written after. **Design:** §5.3. **Depends on:** 3.3, 15.3.

**Technical:** leaving or removal marks the group as due a new epoch; the next remaining member's device to sync makes it and wraps it to the remaining
members' account keys; a device seals under the newest epoch it holds, and the server accepts any epoch of the group, so that a device offline across
the rotation loses nothing; earlier epochs kept for the remaining members.

**Accepts when:** after a removal, a new expense is sealed under a new epoch that the removed person has no wrap of; a device offline across the
rotation still opens both epochs once synced.

**Done as:** migration `0008_add_key_rotation` (`grp.key_rotation_due`), set by `member.leave` and `member.remove` in their transaction
(`src/groups/lifecycle.ts`). `src/keys/rotation.ts`: `dueRotations` (in `GET /api/keys/groups` as `rotations`, for an active member holding the current
epoch, with every remaining member's account key) and `rotateGroupKey`, `POST /api/keys/groups/rotate`, which moves `key_epoch` on only from the
current epoch, while due, for an active member holding it, in one `UPDATE`, then stores the new wraps for active members with a key; the rotating
account's own wrap is required. Two devices rotating at once make one epoch: the second is told `not_current` (409). On the device,
`GroupKeys.sync` rotates after granting and keeps the new key only once the server took it (a lost answer is recovered through the account's own
wrap); `newestKey` gives the newest epoch held, which is what a device seals under. The server already accepted any epoch of the group (5.1), so an
offline device loses nothing. Tests: after a removal the next exchange rotates once, new text is sealed under epoch 2, the removed person has a wrap of
epoch 1 only, and a device offline across it opens both; a race takes one epoch, and someone not in the group none; seen failing with the mark taken
out. The removed person's old wraps stay, as earlier text was theirs to read.
