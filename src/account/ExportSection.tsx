'use client';

import { useState } from 'react';
import { Alert, Button } from '@sovereignfs/ui';
import { exportFileName, makeExport } from '../portability/collect';
import type { ExportFile } from '../portability/format';
import { useGroupKeys, useMe, useSync } from '../sync/react';
import styles from './Account.module.css';

/**
 * Settings, Data, **Export** (DESIGN.md §17): one file of your profile and every group you are in, made here in the browser from this device, with what
 * was written opened, so the file is plain text and the screen says so. Noted on your activity page in core when Tally is hosted (§14.5).
 */
export function ExportSection({ profile }: { profile: ExportFile['profile'] }) {
  const me = useMe();
  const client = useSync();
  const keys = useGroupKeys();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function download() {
    if (!client || !me) return;
    setBusy(true);
    setSaid(null);
    setProblem(null);
    try {
      // The latest of every group first, where there is a connection; offline, what this device has.
      await client.sync().catch(() => undefined);
      const now = Date.now();
      const file = await makeExport({ db: client.db, keys, personId: me.personId, profile, now });
      const blob = new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = exportFileName(now);
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      void fetch('/api/account/exported', { method: 'POST' }).catch(() => undefined);
      setSaid(
        file.unopened > 0
          ? `Downloaded. ${file.unopened} piece${file.unopened === 1 ? '' : 's'} of text could not be opened on this device yet, and ${file.unopened === 1 ? 'is' : 'are'} left out.`
          : 'Downloaded.',
      );
    } catch {
      setProblem('The file could not be made. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.group}>
      <h2>Export</h2>
      <p>
        One file of your profile and every group you are in, whole: its members by name, its
        expenses and payments, and their comments. No one else’s email address is in it.
      </p>
      <p className={styles.hint}>
        The file is plain text: what was written in your groups is readable in it. Keep it somewhere
        safe.
      </p>
      <div>
        <Button variant="secondary" onClick={() => void download()} disabled={busy || !client}>
          Download your data
        </Button>
      </div>
      {said ? <p role="status">{said}</p> : null}
      {problem ? <Alert variant="error">{problem}</Alert> : null}
    </div>
  );
}
