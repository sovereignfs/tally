import { fromBase64Url, type Bytes } from '../cipher/bytes';
import { CipherError } from '../cipher/errors';
import {
  type RowBinding,
  importGroupKey,
  newGroupKey,
  openRow,
  sealRow,
  epochOf,
} from '../cipher/seal';
import { unwrapWithPrivateKey, wrapToPublicKey } from '../cipher/wrap';
import type { AccountKeys } from './unlock';

/**
 * **A group's key on a device** (DESIGN.md §5.3): unwrapped from the wraps the server keeps for the account, kept in the device's vault, and wrapped
 * by this device for the group's other members who lack it, all at each exchange (`sync`). Nobody does anything for it: a new member's device, or a
 * device whose account key was replaced, is unlocked by any other member's device at its next exchange.
 */
export interface GrantsApi {
  get(): Promise<{
    wraps: { groupId: string; epoch: number; wrapped: string }[];
    needed: { groupId: string; epoch: number; accountId: string; publicKey: string }[];
    /** Groups someone left, which this device should give a new epoch (DESIGN.md §5.3). */
    rotations?: {
      groupId: string;
      epoch: number;
      members: { accountId: string; publicKey: string }[];
    }[];
  }>;
  put(
    grants: { groupId: string; epoch: number; accountId: string; wrapped: string }[],
  ): Promise<{ accepted: number; refused: number }>;
  /** Sends a new epoch's wraps; `not_current` when another device rotated first, or it is no longer due. */
  rotate(input: {
    groupId: string;
    fromEpoch: number;
    wraps: { accountId: string; wrapped: string }[];
  }): Promise<{ epoch: number } | 'not_current'>;
}

const vaultName = (groupId: string, epoch: number) => `group:${groupId}:${epoch}`;
/** What a group key's wrap is for: this group, this epoch, this account (`src/cipher/wrap.ts`). */
const bindingOf = (groupId: string, epoch: number, accountId: string) => [
  groupId,
  epoch,
  accountId,
];

export class GroupKeys {
  constructor(
    private readonly account: AccountKeys,
    private readonly api: GrantsApi,
  ) {}

  /** The key of a group's epoch on this device, or undefined: the group is not unlocked here yet. */
  async keyFor(groupId: string, epoch: number): Promise<CryptoKey | undefined> {
    const bytes = await this.account.vault.get(vaultName(groupId, epoch));
    return bytes ? importGroupKey(bytes) : undefined;
  }

  /**
   * One exchange: unwraps the group keys the server has for this account that the device lacks, then wraps the keys it holds for each member who
   * lacks one. Nothing happens on a device that is not unlocked.
   */
  async sync(): Promise<{ opened: number; granted: number; rotated: number }> {
    if (!(await this.account.current())) return { opened: 0, granted: 0, rotated: 0 };
    const { opened, grants, rotated } = await this.exchange(await this.api.get());
    const granted = grants.length > 0 ? (await this.api.put(grants)).accepted : 0;
    return { opened, granted, rotated };
  }

  /**
   * The device's half of an exchange, from what the server said (its own route, or a sync's answer, DESIGN.md §11.3): unwraps the keys it lacks, gives
   * a group someone left a new epoch, and returns the wraps it made for the members who lack a key, which the caller sends.
   */
  async exchange(keys: {
    wraps: { groupId: string; epoch: number; wrapped: string }[];
    needed: { groupId: string; epoch: number; accountId: string; publicKey: string }[];
    rotations?: {
      groupId: string;
      epoch: number;
      members: { accountId: string; publicKey: string }[];
    }[];
  }): Promise<{
    opened: number;
    grants: { groupId: string; epoch: number; accountId: string; wrapped: string }[];
    rotated: number;
  }> {
    const held = await this.account.current();
    if (!held) return { opened: 0, grants: [], rotated: 0 };
    let opened = 0;
    for (const wrap of keys.wraps) {
      if (await this.account.vault.get(vaultName(wrap.groupId, wrap.epoch))) continue;
      try {
        const key = await unwrapWithPrivateKey(
          wrap.wrapped,
          held.privateKey,
          held.publicKey,
          bindingOf(wrap.groupId, wrap.epoch, this.account.accountId),
        );
        await this.account.vault.put(vaultName(wrap.groupId, wrap.epoch), key);
        opened++;
      } catch (error) {
        // A wrap that does not open is left: another member's device will wrap it again once the server sees it as missing.
        if (!(error instanceof CipherError)) throw error;
      }
    }
    const grants: { groupId: string; epoch: number; accountId: string; wrapped: string }[] = [];
    for (const need of keys.needed) {
      const key = await this.account.vault.get(vaultName(need.groupId, need.epoch));
      const publicKey = fromBase64Url(need.publicKey);
      if (!key || !publicKey || publicKey.length !== 32) continue;
      grants.push({
        ...need,
        wrapped: await wrapToPublicKey(
          key,
          publicKey,
          bindingOf(need.groupId, need.epoch, need.accountId),
        ),
      });
    }
    let rotated = 0;
    for (const rotation of keys.rotations ?? []) if (await this.rotate(rotation)) rotated++;
    return { opened, grants, rotated };
  }

  /**
   * Gives a group a new epoch because someone left: a new key, wrapped to every remaining member's account key (this one's too), sent; kept in the vault
   * only once the server took it. If the answer is lost, this account's own wrap brings the key back at the next exchange; if another device rotated
   * first, this key is dropped and theirs arrives the same way.
   */
  private async rotate(rotation: {
    groupId: string;
    epoch: number;
    members: { accountId: string; publicKey: string }[];
  }): Promise<boolean> {
    if (!(await this.account.vault.get(vaultName(rotation.groupId, rotation.epoch)))) return false;
    const key = newGroupKey();
    const next = rotation.epoch + 1;
    const wraps: { accountId: string; wrapped: string }[] = [];
    for (const member of rotation.members) {
      const publicKey = fromBase64Url(member.publicKey);
      if (!publicKey || publicKey.length !== 32) continue;
      wraps.push({
        accountId: member.accountId,
        wrapped: await wrapToPublicKey(
          key,
          publicKey,
          bindingOf(rotation.groupId, next, member.accountId),
        ),
      });
    }
    const taken = await this.api.rotate({
      groupId: rotation.groupId,
      fromEpoch: rotation.epoch,
      wraps,
    });
    if (taken === 'not_current') return false;
    await this.account.vault.put(vaultName(rotation.groupId, taken.epoch), key);
    return true;
  }

  /**
   * The key a device seals under: the newest epoch it holds, at most the group's current one (DESIGN.md §5.3). A device that has not yet opened the
   * newest still writes, under an older epoch the server accepts.
   */
  async newestKey(
    groupId: string,
    epoch: number,
  ): Promise<{ key: CryptoKey; epoch: number } | undefined> {
    for (let e = epoch; e >= 1; e--) {
      const key = await this.keyFor(groupId, e);
      if (key) return { key, epoch: e };
    }
    return undefined;
  }

  /**
   * What the browser sends to make a group (DESIGN.md §7.1): an id made here, the name sealed under the group's first key and bound to that id, and
   * that key wrapped to this account's own key. The key is kept in the vault first, so the group is readable here the moment it exists.
   */
  async prepareGroup(name: string): Promise<{ groupId: string; sealed: string; keyWrap: string }> {
    const held = await this.account.current();
    if (!held) throw new CipherError('wrong_key');
    const groupId = crypto.randomUUID();
    const key: Bytes = newGroupKey();
    await this.account.vault.put(vaultName(groupId, 1), key);
    const sealed = await sealRow({ name }, await importGroupKey(key), 1, {
      group: groupId,
      table: 'grp',
      row: groupId,
    });
    const keyWrap = await wrapToPublicKey(
      key,
      held.publicKey,
      bindingOf(groupId, 1, this.account.accountId),
    );
    return { groupId, sealed, keyWrap };
  }

  /**
   * A row's sealed text, opened with the key it was sealed under and sealed again for another row, under the target group's newest epoch held here (at
   * most `targetEpoch`): moving a refused expense to another group (§11.5). The text is in memory only for this.
   */
  async reseal(
    sealed: string,
    from: RowBinding,
    to: RowBinding,
    targetEpoch: number,
  ): Promise<string> {
    const key = await this.keyFor(from.group, epochOf(sealed));
    const target = await this.newestKey(to.group, targetEpoch);
    if (!key || !target) throw new CipherError('wrong_key');
    return sealRow(await openRow(sealed, key, from), target.key, target.epoch, to);
  }

  /** Seals a group's new name under its current epoch's key, for a rename. */
  async sealName(groupId: string, epoch: number, name: string): Promise<string> {
    const key = await this.keyFor(groupId, epoch);
    if (!key) throw new CipherError('wrong_key');
    return sealRow({ name }, key, epoch, { group: groupId, table: 'grp', row: groupId });
  }

  /** A group's name, opened here, or undefined while the group is not unlocked on this device (shown as "…"). */
  async openName(group: { id: string; sealed: string }): Promise<string | undefined> {
    const key = await this.keyFor(group.id, epochOf(group.sealed));
    if (!key) return undefined;
    const content = await openRow(group.sealed, key, {
      group: group.id,
      table: 'grp',
      row: group.id,
    });
    return typeof content.name === 'string' ? content.name : undefined;
  }
}

/** The real `GrantsApi`: the app's route, with this page's cookies and Origin. */
export const httpGrantsApi: GrantsApi = {
  async get() {
    const reply = await fetch('/api/keys/groups', { cache: 'no-store' });
    if (!reply.ok) throw new Error(`grants: ${reply.status}`);
    return (await reply.json()) as Awaited<ReturnType<GrantsApi['get']>>;
  },
  async put(grants) {
    const reply = await fetch('/api/keys/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grants }),
    });
    if (!reply.ok) throw new Error(`grants: ${reply.status}`);
    return (await reply.json()) as { accepted: number; refused: number };
  },
  async rotate(input) {
    const reply = await fetch('/api/keys/groups/rotate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (reply.status === 409) return 'not_current';
    if (!reply.ok) throw new Error(`rotate: ${reply.status}`);
    return (await reply.json()) as { epoch: number };
  },
};
