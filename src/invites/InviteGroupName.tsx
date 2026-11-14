'use client';

import { useEffect, useState } from 'react';
import { type Bytes, fromBase64Url } from '../cipher/bytes';
import { importGroupKey, openRow } from '../cipher/seal';
import { unwrapWithSecret } from '../cipher/wrap';

/**
 * The group's name on an invitation's page (DESIGN.md §6.3, §5.3): opened in the browser from the link's fragment, which the browser never sends, with
 * the wrap of the group's key the invitation carries. Without a fragment (an emailed link), or one that does not open it, nothing is shown: the page
 * names the inviter alone.
 */
export async function keyFromFragment(
  groupId: string,
  keyWrap: string,
  hash: string,
): Promise<{ key: Bytes; epoch: number } | undefined> {
  const match = /^#?(\d{1,9})\.([A-Za-z0-9_-]{43})$/.exec(hash);
  const secret = match?.[2] ? fromBase64Url(match[2]) : undefined;
  const epoch = Number(match?.[1]);
  if (!secret || !Number.isSafeInteger(epoch) || epoch < 1) return undefined;
  try {
    return { key: await unwrapWithSecret(keyWrap, secret, 'invitation', [groupId, epoch]), epoch };
  } catch {
    return undefined;
  }
}

/**
 * The link's fragment, kept in this tab while the person makes an account or signs in and comes back (those pages do not carry it), keyed by the
 * invitation's group. In the tab only, never sent: the same as the fragment itself.
 */
const fragmentKey = (groupId: string) => `tally.invite.${groupId}`;
export function rememberedFragment(groupId: string): string {
  try {
    const hash = window.location.hash;
    if (hash.length > 1) {
      window.sessionStorage.setItem(fragmentKey(groupId), hash);
      return hash;
    }
    return window.sessionStorage.getItem(fragmentKey(groupId)) ?? '';
  } catch {
    return window.location.hash;
  }
}
export function forgetFragment(groupId: string) {
  try {
    window.sessionStorage.removeItem(fragmentKey(groupId));
  } catch {
    // Nothing kept.
  }
}

export function InviteGroupName({
  groupId,
  keyWrap,
  groupSealed,
}: {
  groupId: string;
  keyWrap: string | null;
  groupSealed: string;
}) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!keyWrap) return;
    void (async () => {
      const opened = await keyFromFragment(groupId, keyWrap, rememberedFragment(groupId));
      if (!opened) return;
      try {
        const content = await openRow(groupSealed, await importGroupKey(opened.key), {
          group: groupId,
          table: 'grp',
          row: groupId,
        });
        if (typeof content.name === 'string') setName(content.name);
      } catch {
        // Not this group's key: the inviter alone is named.
      }
    })();
  }, [groupId, keyWrap, groupSealed]);
  if (!name) return null;
  return (
    <p role="status" aria-label="The group">
      The group is <strong>{name}</strong>.
    </p>
  );
}
