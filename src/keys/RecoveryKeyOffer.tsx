'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Button, CopyButton, Dialog } from '@sovereignfs/ui';
import { newRecoverySecret, recoveryCode } from '../cipher/recovery';
import { AccountKeys, httpKeyApi } from './unlock';

/**
 * **The recovery key, offered** (DESIGN.md §5.3): a code to copy, download or print, with a QR code, and one sentence on what it is for. It can be
 * skipped, and nothing depends on it: losing it costs nothing while another device or another member remains. The wrap is made only once the person
 * says they kept it, so a skipped offer leaves nothing behind. Shown once after sign-up (`OFFER_FLAG`), and from Settings (task 2.6).
 */
export const OFFER_FLAG = 'tally.offer-recovery';

export function RecoveryKeyOffer({
  accountId,
  open,
  onClose,
}: {
  accountId: string;
  open: boolean;
  onClose: (saved: boolean) => void;
}) {
  const [secret] = useState(() => newRecoverySecret());
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (open) void recoveryCode(secret).then(setCode);
  }, [open, secret]);

  async function kept() {
    setBusy(true);
    setFailed(false);
    try {
      const keys = await AccountKeys.open(accountId, httpKeyApi);
      try {
        await keys.putSecretWrap('recovery', secret);
      } finally {
        keys.close();
      }
      onClose(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!code) return;
    const text = `Your Tally recovery key\n\n${code}\n\nKeep it somewhere safe. It unlocks your groups on a new device when no other device of yours is at hand.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tally-recovery-key.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onClose={() => onClose(false)} title="Save your recovery key" size="md">
      <p style={{ marginTop: 0 }}>
        If you ever sign in on a new device with no other device of yours at hand, this unlocks your
        groups. You will rarely need it, and you can skip it: your other devices, and the people in
        your groups, can unlock a new device too.
      </p>
      {code ? (
        <div
          style={{
            display: 'grid',
            gap: 'var(--sv-space-3)',
            justifyItems: 'center',
            margin: 'var(--sv-space-4) 0',
          }}
        >
          <output
            aria-label="Your recovery key"
            style={{
              fontFamily: 'var(--sv-font-family-mono)',
              fontSize: 'var(--sv-font-size-lg)',
              letterSpacing: '0.05em',
              textAlign: 'center',
              wordBreak: 'break-word',
            }}
          >
            {code}
          </output>
          <div
            aria-hidden
            style={{ background: 'var(--sv-color-surface)', padding: 'var(--sv-space-2)' }}
          >
            <QRCodeSVG value={code} size={128} />
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--sv-space-2)',
              justifyContent: 'center',
            }}
          >
            <CopyButton text={code} label="Copy" variant="secondary" />
            <Button variant="secondary" onClick={download}>
              Download
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
          </div>
        </div>
      ) : null}
      {failed ? <p role="alert">It could not be kept just now. Try again in a moment.</p> : null}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--sv-space-2)',
          justifyContent: 'flex-end',
        }}
      >
        <Button variant="ghost" onClick={() => onClose(false)} disabled={busy}>
          Not now
        </Button>
        <Button onClick={() => void kept()} loading={busy} disabled={!code}>
          I have kept it
        </Button>
      </div>
    </Dialog>
  );
}
