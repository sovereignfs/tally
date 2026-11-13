# Epic 15: Encryption

## Status

📋 Planned.

## Overview

What people write in a group (its name, descriptions, notes, comments) is sealed on the members' devices under the group's key, and the server holds
only ciphertext of it; the figures stay readable so that the server remains the referee. Nobody handles a key: each account has one, made in the
browser, and **a new device unlocks with the same password or passkey that signs it in**, with nobody else online; adders unlock new members; another
device and a recovery key are the fallbacks (`DESIGN.md` §5.3). The cipher is Tusk's, copied and changed: its list key becomes the group key, bound to
the group and its epoch, and its opt-in personal key and operator-key mode are left out.

## Related

[`DESIGN.md`](../../DESIGN.md) §5.3, §6.3, §11.2, §11.3, §12.2, §14.1, §17, §18, §19.3 · Tusk's `DESIGN.md` §9, `docs/encryption.md`, `src/cipher/`

## Tasks

#### 📋 15.1 — The cipher

**Goal:** the primitives every sealed field and every key goes through, pure and tested. **Design:** §5.3. **Depends on:** 1.2.

**Technical:** `src/cipher/`, copied from Tusk: `base64`, `bech32`, `errors`, `identity` (age X25519), `device` (an identity kept as a non-extractable
key, or sealed under one where X25519 cannot be stored), `field` (AES-256-GCM, random nonce, the binding in the authenticated data) and `list-key`
renamed `group-key`; `testing`. Changed: the binding adds the group and the epoch, and the sealed form carries the epoch (`<epoch>.<base64url>`). New:
`password` (Argon2id with a salt and stored parameters, giving the sign-in value and the unwrapping value as two separate outputs); `prf` (an
AES-GCM key from a WebAuthn PRF output, through HKDF); `recovery` (128 random bits as a code to copy, download or print, with a QR made in the browser
and no third-party load, read back forgivingly: case, spaces, dashes). `age-encryption` and the Argon2id implementation pinned exactly; if the
implementation is WebAssembly, the CSP's `wasm-unsafe-eval` is added for it and the security headers task says so.

**Accepts when:** a field opens only with its own group, table, row, field and epoch, and a tampered one is refused; a wrap opens only with its key, and
a wrong key is told apart from a damaged value; the two password outputs differ and neither gives the other; a recovery code survives being retyped
with spaces and lower case; Argon2id takes under a second on a mid-range phone with the chosen parameters; the module imports nothing from the server.

#### 📋 15.2 — Account keys and unlocking

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

#### 📋 15.3 — Group keys and granting

**Goal:** a group's key reaches every member's account, and nothing else's. **Design:** §5.3, §6.2, §11.3. **Depends on:** 15.2, 3.2.

**Technical:** `key_wrap`, `grp.key_epoch`; creating a group (3.2) carries the first epoch wrapped to the creator's account key; adding a person with an
account (8.2) carries the wrap to their account key, made by the adder's device, in the same operation; a grants exchange (`/api/keys`, folded into
`/api/sync` once 6.1 is in) answering the wraps the account lacks and the members whose account key lacks a wrap of an epoch the device holds (a
claimed placeholder, a replaced account key), and accepting a wrap only for an active member of that group from a device of one (the permission in the
statement); a group not yet unlocked shows its figures and "…" for its words with one line saying what will unlock it; sealing in the outbox deferred
until the key arrives.

**Accepts when:** a member added by an adder reads the group's words on first load; a replaced account key is re-wrapped by another member's device
within one sync; a wrap for someone not in the group is refused as not found; a mutation recorded on a device before it was unlocked is sealed and
applied once the key arrives.

#### 📋 15.4 — The recovery key

**Goal:** a last way in, offered and never required. **Design:** §5.3, §16. **Depends on:** 15.2.

**Technical:** a wrap of the account key under the recovery code (`method` `recovery`); offered once after sign-up (copy, download, print, with a QR)
and skippable; Settings > Recovery key shows whether it was saved, makes a new one (replacing the wrap) and explains it in two sentences; on a device
that is waiting, "Use your recovery key" unlocks the account key and so every group.

**Accepts when:** after a password reset, with no other device and no passkey, the code alone unlocks every group; a replaced code unlocks nothing;
skipping it leaves every feature working.

#### 📋 15.5 — An invitation link that carries the key

**Goal:** someone opening a copied invitation reads the group at once. **Design:** §5.3, §6.3. **Depends on:** 8.3, 15.3.

**Technical:** the inviter's device makes the link's secret and wraps the group key to it (`invitation.key_wrap`); the copied link is
`/invite/<token>#<secret>`, offered first in the invitation dialog, and the emailed one has no fragment; the invitation page opens the group's name from
the fragment in the browser, or names the inviter alone; claiming with a fragment wraps the key to the claimer's account key in the claim; revoking,
expiring or using the invitation deletes its wrap.

**Accepts when:** a copied link opens the group's words on first load; an emailed link's group is unlocked by a member's device at its next sync; no
request to the server carries the fragment (checked in Playwright's request log); a used invitation's wrap is gone.

#### 📋 15.6 — Rotating a group's key

**Goal:** someone who left cannot read what is written after. **Design:** §5.3. **Depends on:** 3.3, 15.3.

**Technical:** leaving or removal marks the group as due a new epoch; the next remaining member's device to sync makes it and wraps it to the remaining
members' account keys; a device seals under the newest epoch it holds, and the server accepts any epoch of the group, so that a device offline across
the rotation loses nothing; earlier epochs kept for the remaining members.

**Accepts when:** after a removal, a new expense is sealed under a new epoch that the removed person has no wrap of; a device offline across the
rotation still opens both epochs once synced.
