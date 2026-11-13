# Epic 15: Encryption

## Status

📋 Planned.

## Overview

What people write in a group (its name, descriptions, notes, comments) is sealed on the members' devices under the group's key, and the server holds
only ciphertext of it; the figures stay readable so that the server remains the referee. Nobody handles a key: devices make their own, unlock each other
automatically, and the one thing a person is offered to keep is a recovery key (`DESIGN.md` §5.3). The cipher is Tusk's, copied and changed: its list
key becomes the group key, bound to the group and its epoch, and its opt-in personal key and operator-key mode are left out.

## Related

[`DESIGN.md`](../../DESIGN.md) §5.3, §6.3, §11.2, §11.3, §12.2, §17, §18, §19.3 · Tusk's `DESIGN.md` §9, `docs/encryption.md`, `src/cipher/`

## Tasks

#### 📋 15.1 — The cipher

**Goal:** the primitives every sealed field and every key goes through, pure and tested. **Design:** §5.3. **Depends on:** 1.2.

**Technical:** `src/cipher/`, copied from Tusk: `base64`, `bech32`, `errors`, `identity` (age X25519), `device` (a non-extractable device key, or the
identity sealed under one where X25519 cannot be stored), `field` (AES-256-GCM, random nonce, the binding in the authenticated data) and `list-key`
renamed `group-key`; `testing`. Changed: the binding adds the group and the epoch, and the sealed form carries the epoch (`<epoch>.<base64url>`); a
`recovery` module renders an identity as a code to copy, download or print, with a QR made in the browser (no third-party load), and reads it back
forgivingly (case, spaces, dashes). `age-encryption` pinned exactly. Runs in the browser and in Vitest; nothing of it on the server but form checks.

**Accepts when:** a field opens only with its own group, table, row, field and epoch, and a tampered one is refused; a wrap opens only with its
identity, and a wrong key is told apart from a damaged value; a recovery code survives being retyped with spaces and lower case; the module imports
nothing from the server.

#### 📋 15.2 — Devices

**Goal:** every signed-in browser has a key of its own, unseen. **Design:** §5.3, §16. **Depends on:** 15.1, 2.1, 1.5.

**Technical:** `device` and `src/keys/`; on the first signed-in load a browser makes its device key and registers its public half (an operation,
session and `Origin` checked); the key kept in the device's store; sign-out deletes the key with the store, and the server deletes the device and its
wraps; Settings > Devices lists the account's devices (added, last synced) with Remove, which signs that device out and deletes its wraps;
`People.deletePerson` removes devices and wraps; in `src/access/routes.ts` with the second-person test.

**Accepts when:** two browsers of one account are two devices; signing out of one leaves no wrap for it; a second person cannot list or remove the
first's devices; deleting a person leaves no device or wrap of theirs.

#### 📋 15.3 — Group keys and granting

**Goal:** a group's key reaches every device of its members, and nothing else, with nobody doing anything. **Design:** §5.3, §11.3. **Depends on:**
15.2, 3.2.

**Technical:** `key_wrap`, `grp.key_epoch`; creating a group (3.2) carries the first epoch wrapped to the creator's devices and recovery key; a grants
endpoint (`/api/keys`, folded into `/api/sync` once 6.1 is in) answering the wraps the device lacks and the devices and recovery keys it should wrap
for, and accepting wraps only for a device of an active member of that group from a device that is one (the permission in the statement); the device
side: unwrap into the store, wrap what it is asked, at each sync; a group not yet unlocked shows its figures and "…" for its words with one line saying
why; sealing in the outbox deferred until the key arrives.

**Accepts when:** a second device of an account is unlocked by the first within one sync; a new member is unlocked by any other member's device; a
wrap for a device of someone not in the group is refused as not found; a mutation recorded on a device before it was unlocked is sealed and applied
once the key arrives.

#### 📋 15.4 — The recovery key

**Goal:** a person can unlock a new device alone, and is never made to. **Design:** §5.3, §16. **Depends on:** 15.3.

**Technical:** made with the account and registered as a `recovery` device; offered once after sign-up (copy, download, print, with a QR) and
skippable; Settings > Recovery key shows whether it was saved, makes a new one (deleting the old one's wraps) and explains it in two sentences; on a
device that is waiting, "Use your recovery key" unlocks every group at once and wraps them to the device; the sentence on what losing it means.

**Accepts when:** a fresh device with no other device online is unlocked by the code alone; a replaced recovery key unlocks nothing; skipping it leaves
every feature working.

#### 📋 15.5 — An invitation link that carries the key

**Goal:** someone opening a copied invitation reads the group at once. **Design:** §5.3, §6.3. **Depends on:** 8.3, 15.3.

**Technical:** the inviter's device makes the link's secret and wraps the group key to it (`invitation.key_wrap`); the copied link is
`/invite/<token>#<secret>`, the emailed one has no fragment; the invitation page opens the group's name from the fragment in the browser, or names the
inviter alone; claiming with a fragment wraps the key to the new device in the claim's exchange; revoking, expiring or using the invitation deletes its
wrap.

**Accepts when:** a copied link opens the group's words on first load; an emailed link's group is unlocked by a member's device; no request to the server
carries the fragment (checked in Playwright's request log); a used invitation's wrap is gone.

#### 📋 15.6 — Rotating a group's key

**Goal:** someone who left cannot read what is written after. **Design:** §5.3. **Depends on:** 3.3, 15.3.

**Technical:** leaving or removal marks the group as due a new epoch; the next remaining member's device to sync makes it and wraps it for the remaining
devices and recovery keys; a device seals under the newest epoch it holds, and the server accepts any epoch of the group, so that a device offline
across the rotation loses nothing; earlier epochs kept for the remaining members.

**Accepts when:** after a removal, a new expense is sealed under a new epoch that the removed person's devices have no wrap of; a device offline across
the rotation still opens both epochs once synced.
