'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, ConfirmDialog } from '@sovereignfs/ui';
import { AccountKeys, httpKeyApi, type ServerKeys } from './unlock';

/**
 * **The account's key on this device, as the shell shows it** (DESIGN.md §5.3). Almost always nothing at all: the password or passkey that signed in
 * unlocked it. Otherwise one quiet line with what will unlock it (another of your devices, or starting afresh), and nothing is refused meanwhile. On an
 * unlocked device, it checks every thirty seconds while the page is visible whether a new device of the account is asking, and asks the person:
 * "Allow your new device to open your groups?"
 */
type State =
  | { kind: 'checking' }
  | { kind: 'unlocked' }
  | { kind: 'locked' }
  | { kind: 'asking'; label: string }
  | { kind: 'failed' };

const POLL_MS = 30_000;

function describeDevice(): string {
  const agent = navigator.userAgent;
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'A browser';
  const system = /iPhone/.test(agent)
    ? 'iPhone'
    : /iPad/.test(agent)
      ? 'iPad'
      : /Android/.test(agent)
        ? 'Android'
        : /Mac OS X/.test(agent)
          ? 'Mac'
          : /Windows/.test(agent)
            ? 'Windows'
            : /Linux/.test(agent)
              ? 'Linux'
              : 'a device';
  return `${browser} on ${system}`;
}

export function KeyGate({ accountId }: { accountId: string }) {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [requests, setRequests] = useState<ServerKeys['requests']>([]);
  const [confirmAfresh, setConfirmAfresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const keysRef = useRef<AccountKeys | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const keys = useCallback(async () => {
    keysRef.current ??= await AccountKeys.open(accountId, httpKeyApi);
    return keysRef.current;
  }, [accountId]);

  const check = useCallback(async () => {
    try {
      const k = await keys();
      const server = await httpKeyApi.get();
      if (!server.accountKey) {
        // No key yet (an account that has never signed in with a password, such as one that came through Sovereign): made now, unseen.
        await k.startAfresh();
        setState({ kind: 'unlocked' });
        return;
      }
      if (await k.current()) {
        setState({ kind: 'unlocked' });
        setRequests(server.requests);
      } else setState((now) => (now.kind === 'asking' ? now : { kind: 'locked' }));
    } catch {
      setState({ kind: 'failed' });
    }
  }, [keys]);

  useEffect(() => {
    void check();
    const tick = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
      abortRef.current?.abort();
      keysRef.current?.close();
      keysRef.current = null;
    };
  }, [check]);

  async function askAnotherDevice() {
    setBusy(true);
    try {
      const k = await keys();
      const label = describeDevice();
      const { waitForApproval } = await k.askAnotherDevice(label);
      setState({ kind: 'asking', label });
      setBusy(false);
      abortRef.current = new AbortController();
      const outcome = await waitForApproval(abortRef.current.signal);
      setState({ kind: outcome === 'unlocked' ? 'unlocked' : 'locked' });
    } catch {
      setBusy(false);
      setState({ kind: 'failed' });
    }
  }

  async function startAfresh() {
    setBusy(true);
    try {
      await (await keys()).startAfresh();
      setConfirmAfresh(false);
      setState({ kind: 'unlocked' });
    } catch {
      setState({ kind: 'failed' });
    } finally {
      setBusy(false);
    }
  }

  async function answer(request: ServerKeys['requests'][number], allow: boolean) {
    setBusy(true);
    try {
      const k = await keys();
      if (allow) await k.approve(request);
      else await k.decline(request.id);
      setRequests((now) => now.filter((r) => r.id !== request.id));
    } finally {
      setBusy(false);
    }
  }

  const request = state.kind === 'unlocked' ? requests[0] : undefined;

  return (
    <>
      {state.kind === 'locked' ? (
        <div
          role="region"
          aria-label="This device is locked"
          style={{ padding: 'var(--sv-space-3) var(--sv-space-4) 0' }}
        >
          <Alert variant="info" heading="Your groups’ words are locked on this device">
            <p style={{ margin: '0 0 var(--sv-space-2)' }}>
              Amounts and balances show as usual. Another of your devices can unlock the rest: open
              Tally there and allow this one.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sv-space-2)' }}>
              <Button onClick={() => void askAnotherDevice()} loading={busy}>
                Ask another device
              </Button>
              <Button variant="secondary" onClick={() => setConfirmAfresh(true)} disabled={busy}>
                Start afresh
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}
      {state.kind === 'asking' ? (
        <div role="status" style={{ padding: 'var(--sv-space-3) var(--sv-space-4) 0' }}>
          <Alert variant="info" heading="Waiting for another of your devices">
            Open Tally on a device where you are signed in, and allow <strong>{state.label}</strong>
            . This page unlocks by itself.
          </Alert>
        </div>
      ) : null}
      {state.kind === 'failed' ? (
        <div role="status" style={{ padding: 'var(--sv-space-3) var(--sv-space-4) 0' }}>
          <Alert variant="warning" heading="Could not reach the server to unlock this device">
            Your groups’ words stay locked until it answers. This page tries again by itself.
          </Alert>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmAfresh}
        onClose={() => setConfirmAfresh(false)}
        title="Start afresh on this device?"
        message="This gives your account a new key. What your groups hold stays sealed to you until another member opens Tally, which unlocks it for your new key by itself. Use it only if none of your other devices is at hand."
        confirmLabel="Start afresh"
        onConfirm={() => void startAfresh()}
        pending={busy}
      />
      <ConfirmDialog
        open={request !== undefined}
        onClose={() => request && void answer(request, false)}
        title="Allow your new device to open your groups?"
        message={
          request
            ? `${request.label} is asking to open your groups. Allow it only if it is yours and you are signing in on it now.`
            : ''
        }
        confirmLabel="Allow"
        cancelLabel="That was not me"
        onConfirm={() => request && void answer(request, true)}
        pending={busy}
      />
    </>
  );
}
