'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, ColorPicker, Dialog, FormField, Input } from '@sovereignfs/ui';
import { DEFAULT_COLOR, SWATCHES } from '../groups/colors';
import { useGroupKeys, useMe, useSync } from '../sync/react';
import { CurrencyPicker } from '../ui/CurrencyPicker';
import styles from './Screens.module.css';

/**
 * **New group** (DESIGN.md §7.1, §15.2): a name, a colour and a currency (the person's primary one first). Making a group is an online operation (§11.6):
 * the device makes the group's first key, seals the name under it and wraps it to the account's own key (`GroupKeys.prepareGroup`), the server makes the
 * group at once, and the device's next sync brings it into the store. Offline it says it needs a connection and changes nothing.
 */
export function NewGroupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const keys = useGroupKeys();
  const client = useSync();
  const me = useMe();
  const router = useRouter();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [currency, setCurrency] = useState(me?.primaryCurrency ?? 'EUR');
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function create() {
    setProblem(null);
    const trimmed = name.trim();
    if (trimmed === '' || [...trimmed].length > 100)
      return setProblem('A group needs a name, of at most 100 characters.');
    if (typeof navigator !== 'undefined' && !navigator.onLine)
      return setProblem('Making a group needs a connection.');
    if (!keys) return setProblem('This device is not unlocked yet. Wait a moment, and try again.');
    setWorking(true);
    try {
      const prepared = await keys.prepareGroup(trimmed);
      const reply = await fetch('/api/ops', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'group.create', ...prepared, color, defaultCurrency: currency }),
      });
      if (reply.status === 409) {
        const body = (await reply.json().catch(() => ({}))) as { message?: string };
        return setProblem(body.message ?? 'That group could not be made.');
      }
      if (!reply.ok) return setProblem('That group could not be made. Try again.');
      // Brought into the store by a sync, waited for a moment only: the group's page syncs itself if it is not there yet.
      await Promise.race([client?.sync(), new Promise((resolve) => setTimeout(resolve, 3_000))]);
      setName('');
      onClose();
      router.push(`/g/${prepared.groupId}`);
    } catch {
      setProblem('Making a group needs a connection.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} aria-label="New group" title="New group" size="sm">
      <form
        className={styles.stack}
        aria-label="New group"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <h2>New group</h2>
        {problem ? <Alert variant="error">{problem}</Alert> : null}
        <FormField label="Name" required>
          {(field) => (
            <Input
              {...field}
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder="Lisbon trip"
            />
          )}
        </FormField>
        <div className={styles.stack}>
          <span className={styles.small}>Colour</span>
          <ColorPicker
            aria-label="Colour"
            swatches={SWATCHES}
            value={color}
            onChange={(value) => setColor(value ?? DEFAULT_COLOR)}
          />
        </div>
        <div className={styles.stack}>
          <span className={styles.small}>Currency</span>
          <CurrencyPicker
            value={currency}
            onChange={setCurrency}
            first={me ? [me.primaryCurrency] : []}
            aria-label="Currency"
          />
        </div>
        <div className={styles.row}>
          <Button type="submit" disabled={working}>
            {working ? 'Making…' : 'Make the group'}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
