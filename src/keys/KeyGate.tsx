'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, ConfirmDialog, Dialog, FormField, Input } from '@sovereignfs/ui';
import { CipherError } from '../cipher/errors';
import { parseRecoveryCode } from '../cipher/recovery';
import { OFFER_FLAG, RecoveryKeyOffer } from './RecoveryKeyOffer';
import { GroupKeys, httpGrantsApi } from './groups';
import { AccountKeys, httpKeyApi, type ServerKeys } from './unlock';

/**
 * **The account's key on this device, as the shell shows it** (DESIGN.md §5.3). Almost always nothing at all: the password or passkey that signed in
 * unlocked it. Otherwise one quiet line with what will unlock it (another of your devices, or starting afresh), and nothing is refused meanwhile. On an
 * unlocked device, it looks every thirty seconds while the page is visible: whether a new device of the account is asking ("Allow your new device to
 * open your groups?"), and the exchange of group keys, which unlocks a new member's groups by itself (`groups.ts`).
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
  const [offer, setOffer] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [typed, setTyped] = useState('');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
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
        // Each look is also an exchange of group keys: what this account was given is opened, and what other members lack is wrapped for them.
        await new GroupKeys(k, httpGrantsApi).sync().catch(() => undefined);
        // Offered once, right after sign-up, while the account has no recovery key (DESIGN.md §5.3).
        if (readFlag() && !server.wraps.some((w) => w.method === 'recovery')) setOffer(true);
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

  function readFlag(): boolean {
    try {
      return window.sessionStorage.getItem(OFFER_FLAG) === '1';
    } catch {
      return false;
    }
  }

  function closeOffer() {
    try {
      window.sessionStorage.removeItem(OFFER_FLAG);
    } catch {
      // Not kept: it is offered once more, which does no harm.
    }
    setOffer(false);
  }

  async function useRecoveryKey() {
    setBusy(true);
    setRecoveryError(null);
    try {
      const secret = await parseRecoveryCode(typed);
      const k = await keys();
      await k.unlockWithSecret('recovery', secret);
      await new GroupKeys(k, httpGrantsApi).sync().catch(() => undefined);
      setRecovering(false);
      setTyped('');
      setState({ kind: 'unlocked' });
    } catch (error) {
      if (error instanceof CipherError && error.kind === 'malformed')
        setRecoveryError('That is not a recovery key. Check each character.');
      else if (error instanceof CipherError)
        setRecoveryError(
          'That recovery key is not this account’s, or it was replaced by a newer one.',
        );
      else setRecoveryError('Could not reach the server. Try again in a moment.');
    } finally {
      setBusy(false);
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
              <Button variant="secondary" onClick={() => setRecovering(true)} disabled={busy}>
                Use your recovery key
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
      <RecoveryKeyOffer accountId={accountId} open={offer} onClose={closeOffer} />
      <Dialog
        open={recovering}
        onClose={() => setRecovering(false)}
        title="Use your recovery key"
        size="sm"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void useRecoveryKey();
          }}
        >
          <FormField
            label="Recovery key"
            hint="Spaces, dashes and lower case are fine."
            error={recoveryError ?? undefined}
          >
            {(field) => (
              <Input
                {...field}
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                disabled={busy}
              />
            )}
          </FormField>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--sv-space-2)',
              marginTop: 'var(--sv-space-3)',
            }}
          >
            <Button
              variant="ghost"
              type="button"
              onClick={() => setRecovering(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Unlock
            </Button>
          </div>
        </form>
      </Dialog>
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
