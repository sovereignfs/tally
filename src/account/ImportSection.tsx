'use client';

import { useRef, useState } from 'react';
import { Alert, Button } from '@sovereignfs/ui';
import { prepareImport } from '../portability/prepare';
import { validateFile } from '../portability/validate';
import { useGroupKeys, useSync } from '../sync/react';
import styles from './Account.module.css';

/**
 * Settings, Data, **Import** (DESIGN.md §17): a Tally export becomes **new groups**, with you as their owner and everyone else in them as "not on
 * Tally yet", with their names and no email: their history comes with them, and nobody is joined to anything without asking. The file is read and
 * checked here, each new group's key made here and its text sealed here, so only sealed text leaves this device; the server checks it all again and
 * writes it in one go, or nothing.
 */
export function ImportSection({ name }: { name: string }) {
  const client = useSync();
  const keys = useGroupKeys();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function importFile(file: File) {
    setBusy(true);
    setSaid(null);
    setProblem(null);
    try {
      if (!keys)
        return setProblem('This device is not unlocked yet. Wait a moment, and try again.');
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        return setProblem('That is not a Tally export, or it is damaged. Nothing was imported.');
      }
      const checked = validateFile(raw);
      if (!checked.ok) return setProblem(checked.message);
      const request = await prepareImport(checked.file, keys, name);
      const reply = await fetch('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      }).catch(() => null);
      if (!reply) return setProblem('Importing needs a connection. Nothing was imported.');
      if (!reply.ok) {
        const body = (await reply.json().catch(() => ({}))) as { message?: string };
        return setProblem(body.message ?? 'That file could not be imported. Nothing was imported.');
      }
      await client?.sync().catch(() => undefined);
      const count = request.groups.length;
      setSaid(
        `Imported ${count} group${count === 1 ? '' : 's'}. You will find ${count === 1 ? 'it' : 'them'} with your groups.`,
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className={styles.group}>
      <h2>Import</h2>
      <p>
        A Tally export becomes new groups, with you as their owner. Everyone else in them comes in
        as not on Tally yet, by name, with what they shared: invite them when you are ready.
      </p>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        aria-label="A Tally export to import"
        hidden
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          if (chosen) void importFile(chosen);
        }}
      />
      <div>
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy || !keys}>
          Import a file
        </Button>
      </div>
      {said ? <p role="status">{said}</p> : null}
      {problem ? <Alert variant="error">{problem}</Alert> : null}
    </div>
  );
}
