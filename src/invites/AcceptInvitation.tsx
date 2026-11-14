'use client';

import { useState } from 'react';
import { Alert, AuthButton } from '@sovereignfs/ui';

/**
 * Accepting an invitation as the signed-in person (DESIGN.md §6.3): their account takes the placeholder's place, with everything it had, and they are
 * taken to the group. The group's words open on this device once it has the key: from the link's fragment (15.5), or from any member's device at its
 * next exchange (§5.3).
 */
export function AcceptInvitation({ token, groupId }: { token: string; groupId: string }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    setProblem(null);
    try {
      const reply = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (reply.status === 404) return setProblem('This invitation cannot be used any more.');
      if (!reply.ok) {
        const body = (await reply.json().catch(() => ({}))) as { message?: string };
        return setProblem(body.message ?? 'That did not work. Try again.');
      }
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
