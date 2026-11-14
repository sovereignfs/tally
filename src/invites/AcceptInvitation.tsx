'use client';

import { useState } from 'react';
import { Alert, AuthButton } from '@sovereignfs/ui';
import { GroupKeys, httpGrantsApi } from '../keys/groups';
import { AccountKeys, httpKeyApi } from '../keys/unlock';
import { forgetFragment, keyFromFragment, rememberedFragment } from './InviteGroupName';

/**
 * Accepting an invitation as the signed-in person (DESIGN.md §6.3): their account takes the placeholder's place, with everything it had, and they are
 * taken to the group. The group's words open on this device once it has the key: from the link's fragment (15.5), or from any member's device at its
 * next exchange (§5.3).
 */
export function AcceptInvitation({
  token,
  groupId,
  accountId,
  keyWrap,
}: {
  token: string;
  groupId: string;
  accountId: string;
  keyWrap: string | null;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    setProblem(null);
    try {
      // The group's key from the link's fragment, kept on this device and wrapped to the account's own key for the claim to store (15.5).
      let selfWrap: { epoch: number; wrapped: string } | undefined;
      if (keyWrap) {
        const opened = await keyFromFragment(groupId, keyWrap, rememberedFragment(groupId));
        if (opened) {
          const groups = new GroupKeys(
            await AccountKeys.open(accountId, httpKeyApi),
            httpGrantsApi,
          );
          selfWrap = await groups.adopt(groupId, opened.epoch, opened.key).catch(() => undefined);
        }
      }
      const reply = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, ...(selfWrap ? { selfWrap } : {}) }),
      });
      if (reply.status === 404) return setProblem('This invitation cannot be used any more.');
      if (!reply.ok) {
        const body = (await reply.json().catch(() => ({}))) as { message?: string };
        return setProblem(body.message ?? 'That did not work. Try again.');
      }
      forgetFragment(groupId);
      window.location.assign(`/g/${groupId}`);
    } catch {
      setProblem('Accepting an invitation needs a connection.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: 'grid', gap: 'var(--sv-space-3)' }}>
      {problem ? <Alert variant="error">{problem}</Alert> : null}
      <AuthButton type="button" onClick={() => void accept()} disabled={busy}>
        {busy ? 'Joining…' : 'Join the group'}
      </AuthButton>
    </div>
  );
}
