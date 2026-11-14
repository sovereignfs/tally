'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, ConfirmDialog, EmptyState, Select } from '@sovereignfs/ui';
import { refusalSentence } from '../actions/validate';
import type { FailedEntry, LocalGroup, LocalMember } from '../local/db';
import { lastSyncedAt, outboxSize, readFailed, readGroups } from '../local/store';
import { MoveRefused } from '../local/store';
import { toMinor } from '../money/amount';
import { formatMoney } from '../money/text';
import { resetDevice } from '../sync/device';
import { useGroupKeys, useStoreChanges, useSync } from '../sync/react';
import styles from './Account.module.css';

/**
 * Settings, This device (DESIGN.md §11.5, §11.6): when it last synced, what it has not sent yet, and **Couldn't sync**: every change the server refused,
 * with the reason in a sentence ("Lisbon was closed."), and what can be done with it: send it again, record it in another group, or let it go. And
 * **Reset this device**, which deletes its copy of the groups and pulls them afresh. Everything here reads the device's store.
 */
interface View {
  lastSynced: number | null;
  unsent: number;
  failed: FailedEntry[];
  groups: (LocalGroup & { name: string | undefined; members: LocalMember[] })[];
}

export function DeviceSection({ accountId }: { accountId: string }) {
  const client = useSync();
  const keys = useGroupKeys();
  const changes = useStoreChanges();
  const [view, setView] = useState<View | null>(null);
  const [target, setTarget] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!client) return;
    let live = true;
    void (async () => {
      const db = client.db;
      const groups = await Promise.all(
        (await readGroups(db)).map(async (group) => ({
          ...group,
          name: await keys?.openName(group).catch(() => undefined),
          members: await db.getAllFromIndex('member', 'byGroup', group.id),
        })),
      );
      const next: View = {
        lastSynced: await lastSyncedAt(db),
        unsent: await outboxSize(db),
        failed: await readFailed(db),
        groups,
      };
      if (live) setView(next);
    })();
    return () => {
      live = false;
    };
  }, [client, keys, changes]);

  if (!client || !view)
    return <p className={styles.muted}>Opening this device’s copy of your groups…</p>;

  const groupOf = (id: string) => view.groups.find((g) => g.id === id);
  const sentenceFor = (entry: FailedEntry) => {
    const group = groupOf(entry.mutation.groupId);
    return refusalSentence(entry.refusal, {
      ...(group?.name ? { group: group.name } : {}),
      member: (memberId) => group?.members.find((m) => m.id === memberId)?.name,
    });
  };
  const whatItWas = (entry: FailedEntry) => {
    const change = entry.mutation.changes[0];
    if (!change || change.op !== 'put' || change.table === 'comment') return 'A change';
    const amount = formatMoney(toMinor(change.row.amount), change.row.currency);
    return change.table === 'expense'
      ? `An expense of ${amount}, ${change.row.date}`
      : `A payment of ${amount}, ${change.row.date}`;
  };
  const movable = (entry: FailedEntry) => {
    const change = entry.mutation.changes[0];
    return (
      entry.mutation.changes.length === 1 && change?.op === 'put' && change.table !== 'comment'
    );
  };

  async function act(work: () => Promise<void>) {
    setProblem(null);
    try {
      await work();
    } catch (error) {
      if (error instanceof MoveRefused && error.reason === 'missing_person') {
        const name = view?.groups
          .flatMap((g) => g.members)
          .find((m) => m.personId === error.personId)?.name;
        setProblem(`${name ?? 'Someone in it'} is not in that group.`);
      } else setProblem('That could not be done. Nothing was lost: try again.');
    }
  }

  return (
    <div className={styles.group}>
      <h2>This device</h2>
      <p className={styles.muted}>
        {view.lastSynced === null
          ? 'Not synced yet.'
          : `Last synced ${new Date(view.lastSynced).toLocaleString()}.`}{' '}
        {view.unsent === 0
          ? 'Everything recorded here has been sent.'
          : `${view.unsent === 1 ? 'One change is' : `${view.unsent} changes are`} waiting to be sent.`}
      </p>

      <h3>Couldn’t sync</h3>
      {problem ? <Alert variant="error">{problem}</Alert> : null}
      {view.failed.length === 0 ? (
        <EmptyState
          icon="check"
          heading="Nothing here"
          description="Every change you recorded reached your groups."
        />
      ) : (
        <ul className={styles.list} aria-label="Couldn’t sync">
          {view.failed.map((entry) => {
            const others = view.groups.filter(
              (g) => g.id !== entry.mutation.groupId && g.closedAt === null,
            );
            const chosen = target[entry.mutationId] ?? others[0]?.id ?? '';
            return (
              <li key={entry.mutationId}>
                <p>
                  <strong>{whatItWas(entry)}</strong>
                  <br />
                  {sentenceFor(entry)}
                </p>
                <div className={styles.row}>
                  <Button
                    variant="secondary"
                    onClick={() => void act(() => client.resend(entry.mutationId))}
                  >
                    Send again
                  </Button>
                  {movable(entry) && others.length > 0 && keys ? (
                    <>
                      <Select
                        aria-label="Group to move it to"
                        value={chosen}
                        onChange={(event) =>
                          setTarget({ ...target, [entry.mutationId]: event.target.value })
                        }
                      >
                        {others.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name ?? 'A group'}
                          </option>
                        ))}
                      </Select>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          void act(() =>
                            client.move(entry.mutationId, chosen, (sealed, from, to) =>
                              keys.reseal(sealed, from, to, groupOf(to.group)?.keyEpoch ?? 1),
                            ),
                          )
                        }
                      >
                        Move there
                      </Button>
                    </>
                  ) : null}
                  <Button
                    variant="secondary"
                    onClick={() => void act(() => client.discard(entry.mutationId))}
                  >
                    Discard
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h3>Reset this device</h3>
      <p className={styles.muted}>
        Deletes this device’s copy of your groups and fetches them again. Use it if something here
        looks wrong.
      </p>
      <div className={styles.row}>
        <Button variant="secondary" onClick={() => setResetting(true)}>
          Reset this device…
        </Button>
      </div>
      <ConfirmDialog
        open={resetting}
        onClose={() => setResetting(false)}
        title="Reset this device?"
        message={
          view.unsent + view.failed.length === 0
            ? 'Your groups are fetched again. Nothing is lost.'
            : `${view.unsent + view.failed.length} change${view.unsent + view.failed.length === 1 ? '' : 's'} recorded here and not in your groups will be lost.`
        }
        confirmLabel="Reset"
        destructive={view.unsent + view.failed.length > 0}
        onConfirm={() => {
          void resetDevice(accountId).then(() => window.location.reload());
        }}
      />
    </div>
  );
}
