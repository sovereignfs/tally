'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  ColorPicker,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  FormField,
  Input,
  PageContainer,
  Select,
  Toggle,
} from '@sovereignfs/ui';
import { DEFAULT_COLOR, SWATCHES } from '../groups/colors';
import { useGroupKeys, useLocal, useMe, useSync } from '../sync/react';
import { CurrencyPicker } from '../ui/CurrencyPicker';
import { readGroupView } from './data';
import { useGroupNames } from './hooks';
import { useGroupViews } from './useGroups';
import styles from './Screens.module.css';

/**
 * **A group's settings** (DESIGN.md §7, §15.3): its details and simplify debts (owners), its people with their roles (owners change them; the last owner
 * is held, and the reason said), what the reader hears of it (§12.2), and its lifecycle: Leave, Remove, Close and Reopen, and Delete, which is there only
 * while the group has never had an expense or a payment. Each is an online operation (§11.6), answered at once; its refusal is shown in its sentence,
 * and every control that cannot be used says why. Adding people and invitations join with 8.2 and 8.3.
 */
type Notify = 'all' | 'involved' | 'none';

export function GroupSettings({ groupId }: { groupId: string }) {
  const me = useMe();
  const client = useSync();
  const keys = useGroupKeys();
  const router = useRouter();
  const view = useLocal(
    (db) => readGroupView(db, groupId, me?.personId ?? ''),
    [groupId, me?.personId],
  );
  const names = useGroupNames(view ? [view.group] : []);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [notify, setNotify] = useState<Notify | null>(null);
  const [confirm, setConfirm] = useState<
    null | 'leave' | 'close' | 'delete' | { remove: string } | { merge: string; into: string }
  >(null);
  // The placeholder whose "Merge into" picker is open, and whom it would merge into.
  const [merging, setMerging] = useState<{ from: string; into: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [invited, setInvited] = useState<Invited | null>(null);

  // What the reader hears is theirs, kept by the server: read once, online.
  useEffect(() => {
    let live = true;
    void op({ op: 'group.read', groupId }, { quiet: true }).then((state) => {
      const choice = (state as { me?: { notify?: Notify } } | undefined)?.me?.notify;
      if (live && choice) setNotify(choice);
    });
    return () => {
      live = false;
    };
    // Once per group.
  }, [groupId]);

  /** One online operation: its answer, or its refusal said, and a sync after, so that the device has the change at once. */
  async function op(
    body: Record<string, unknown>,
    options: { quiet?: boolean; said?: string } = {},
  ): Promise<unknown> {
    if (!options.quiet) {
      setProblem(null);
      setDone(null);
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (!options.quiet) setProblem('This needs a connection.');
      return undefined;
    }
    try {
      // What this device recorded is sent first, so that the server decides on the group as the person sees it (a close must see the expense just
      // added).
      if (!options.quiet) await client?.sync();
      const reply = await fetch('/api/ops', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (reply.status === 404) {
        if (!options.quiet)
          setProblem(
            'That could not be done: the group, or you in it, is not as it was. Reload, and try again.',
          );
        return undefined;
      }
      if (!reply.ok) {
        const refusal = (await reply.json().catch(() => ({}))) as { message?: string };
        if (!options.quiet) setProblem(refusal.message ?? 'That could not be done. Try again.');
        return undefined;
      }
      const answer: unknown = await reply.json();
      if (!options.quiet) {
        await client?.sync();
        if (options.said) setDone(options.said);
      }
      return answer;
    } catch {
      if (!options.quiet) setProblem('This needs a connection.');
      return undefined;
    }
  }

  if (view === undefined) return null;
  if (!view || !view.me || view.me.leftAt !== null)
    return (
      <PageContainer>
        <EmptyState
          icon="layers"
          heading="This group is not here"
          description="It may have been deleted, or you are not in it."
        />
      </PageContainer>
    );

  const owner = view.me.role === 'owner';
  const closed = view.group.closedAt !== null;
  const current = names[groupId];
  const editable = owner && !closed;
  const whyNot = closed
    ? 'The group is closed: reopen it to change anything.'
    : 'Only an owner can change this.';
  const neverUsed = view.expenses.length === 0 && view.payments.length === 0;
  const nameOf = (memberId: string) =>
    memberId === view.me?.id
      ? 'You'
      : (view.members.find((m) => m.id === memberId)?.name ?? 'Someone');
  const whose = (memberId: string) =>
    memberId === view.me?.id ? 'yours' : `${nameOf(memberId)}’s`;
  /** Who a placeholder can be merged into: anyone else still in the group. */
  const others = (memberId: string) =>
    view.members.filter((o) => o.leftAt === null && o.id !== memberId);

  async function rename() {
    const next = (name ?? current ?? '').trim();
    if (!next || [...next].length > 100)
      return setProblem('A group needs a name, of at most 100 characters.');
    const sealed = await keys
      ?.sealName(groupId, view?.group.keyEpoch ?? 1, next)
      .catch(() => undefined);
    if (!sealed) return setProblem('This group is not unlocked on this device yet.');
    await op({ op: 'group.rename', groupId, sealed }, { said: 'The name is changed.' });
  }

  return (
    <PageContainer>
      <article className={styles.stack} aria-label="Group settings">
        <Link href={`/g/${groupId}`} className={styles.small}>
          ← {current ?? 'Back to the group'}
        </Link>
        <h1 style={{ margin: 0 }}>Settings</h1>
        {problem ? <Alert variant="error">{problem}</Alert> : null}
        {done ? <Alert variant="success">{done}</Alert> : null}

        <section className={styles.stack} aria-label="Details">
          <h2 className={styles.small}>Details</h2>
          {editable ? null : <p className={styles.muted}>{whyNot}</p>}
          <form
            className={styles.row}
            aria-label="Name"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <FormField label="Name">
              {(field) => (
                <Input
                  {...field}
                  value={name ?? current ?? ''}
                  maxLength={100}
                  disabled={!editable}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </FormField>
            <Button type="submit" variant="secondary" disabled={!editable}>
              Rename
            </Button>
          </form>
          <div className={styles.stack}>
            <span className={styles.small}>Colour</span>
            <ColorPicker
              aria-label="Colour"
              swatches={SWATCHES}
              value={view.group.color}
              onChange={(value) =>
                editable &&
                void op(
                  { op: 'group.recolour', groupId, color: value ?? DEFAULT_COLOR },
                  { said: 'The colour is changed.' },
                )
              }
            />
          </div>
          <div className={styles.row}>
            <span className={styles.small}>Currency</span>
            <CurrencyPicker
              value={view.group.defaultCurrency}
              onChange={(code) =>
                void op(
                  { op: 'group.currency', groupId, defaultCurrency: code },
                  { said: 'New expenses start in that currency.' },
                )
              }
              first={me ? [me.primaryCurrency] : []}
              aria-label="Default currency"
              disabled={!editable}
            />
          </div>
          <div className={styles.row}>
            <Toggle
              aria-label="Simplify debts"
              checked={view.group.simplifyDebts}
              disabled={!editable}
              onChange={(on) =>
                void op(
                  { op: 'group.simplify', groupId, on },
                  { said: on ? 'Debts are simplified.' : 'Debts are pairwise again.' },
                )
              }
            />
            <span>
              Simplify debts
              <span className={styles.small}>
                {' '}
                · the fewest payments that settle everyone, which can name two people who never
                shared a bill
              </span>
            </span>
          </div>
        </section>

        <section className={styles.stack} aria-label="People">
          <h2 className={styles.small}>People</h2>
          <ul className={styles.list}>
            {view.members
              .filter((m) => m.leftAt === null)
              .map((m) => (
                <li key={m.id} className={styles.line}>
                  <span className={styles.lineMain}>
                    {nameOf(m.id)}
                    <span className={styles.small}>
                      {m.placeholder ? 'not on Tally yet' : m.role === 'owner' ? 'owner' : 'member'}
                    </span>
                    {invited?.personId === m.personId ? (
                      <InvitationLink invitation={invited} name={m.name} />
                    ) : null}
                  </span>
                  {m.placeholder && !closed ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void (async () => {
                          // The copied link carries the group's key in its fragment, made here (15.5); the server keeps only a wrap it cannot open.
                          const carried = await keys
                            ?.invitationKey(groupId, view.group.keyEpoch)
                            .catch(() => undefined);
                          const answer = await op({
                            op: 'invite.create',
                            groupId,
                            personId: m.personId,
                            ...(carried ? { keyWrap: carried.keyWrap } : {}),
                          });
                          const made = answer as
                            | {
                                token?: string;
                                mailed?: boolean;
                                mailHeld?: boolean;
                                mailOn?: boolean;
                              }
                            | undefined;
                          if (made?.token)
                            setInvited({
                              personId: m.personId,
                              token: made.token,
                              fragment: carried?.fragment ?? null,
                              mailed: Boolean(made.mailed),
                              mailHeld: Boolean(made.mailHeld),
                              mailOn: Boolean(made.mailOn),
                            });
                        })()
                      }
                    >
                      {invited?.personId === m.personId ? 'New link' : `Invite ${m.name}`}
                    </Button>
                  ) : null}
                  {owner && !closed && m.role !== null && m.id !== view.me?.id ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void op(
                          {
                            op: 'member.role',
                            groupId,
                            memberId: m.id,
                            role: m.role === 'owner' ? 'member' : 'owner',
                          },
                          {
                            said:
                              m.role === 'owner'
                                ? `${m.name} is a member now.`
                                : `${m.name} is an owner now.`,
                          },
                        )
                      }
                    >
                      {m.role === 'owner' ? 'Make a member' : 'Make an owner'}
                    </Button>
                  ) : null}
                  {owner && !closed && m.id === view.me?.id && m.role === 'owner' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void op(
                          { op: 'member.role', groupId, memberId: m.id, role: 'member' },
                          { said: 'You are a member now.' },
                        )
                      }
                    >
                      Step down
                    </Button>
                  ) : null}
                  {owner && !closed && m.placeholder && others(m.id).length > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={merging?.from === m.id}
                      onClick={() =>
                        setMerging(
                          merging?.from === m.id
                            ? null
                            : { from: m.id, into: others(m.id)[0]?.id ?? '' },
                        )
                      }
                    >
                      Merge
                    </Button>
                  ) : null}
                  {owner && !closed && m.id !== view.me?.id ? (
                    <Button variant="ghost" size="sm" onClick={() => setConfirm({ remove: m.id })}>
                      Remove
                    </Button>
                  ) : null}
                  {merging?.from === m.id ? (
                    // One person in the group twice (§7.2): everything of the placeholder becomes the chosen member's.
                    <span className={styles.row}>
                      <Select
                        aria-label={`Merge ${m.name} into`}
                        value={merging.into}
                        onChange={(event) => setMerging({ from: m.id, into: event.target.value })}
                      >
                        {others(m.id).map((o) => (
                          <option key={o.id} value={o.id}>
                            {nameOf(o.id)}
                          </option>
                        ))}
                      </Select>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!merging.into}
                        onClick={() => setConfirm({ merge: m.id, into: merging.into })}
                      >
                        Merge into them
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
          </ul>
          {closed ? null : (
            <AddPeople
              groupId={groupId}
              inGroup={
                new Set(view.members.filter((m) => m.leftAt === null).map((m) => m.personId))
              }
              add={(body, said) => op({ op: 'member.add', groupId, ...body }, { said })}
              search={(q) =>
                op({ op: 'directory.search', groupId, q }, { quiet: true }) as Promise<
                  { available: boolean; people: DirectoryFound[] } | undefined
                >
              }
            />
          )}
        </section>

        <section className={styles.stack} aria-label="Notifications">
          <h2 className={styles.small}>Notifications</h2>
          <Select
            aria-label="What you hear of this group"
            value={notify ?? 'all'}
            disabled={notify === null || closed}
            onChange={(event) => {
              const next = event.target.value as Notify;
              void op({ op: 'member.notify', groupId, notify: next }, { said: 'Saved.' }).then(
                (answer) => answer && setNotify(next),
              );
            }}
          >
            <option value="all">Everything</option>
            <option value="involved">Only what involves me</option>
            <option value="none">Nothing</option>
          </Select>
          {notify === null ? <p className={styles.small}>This needs a connection.</p> : null}
        </section>

        <section className={styles.stack} aria-label="Leave or close">
          <h2 className={styles.small}>Leave, close or delete</h2>
          <div className={styles.row}>
            {closed ? null : (
              <Button variant="secondary" onClick={() => setConfirm('leave')}>
                Leave the group
              </Button>
            )}
            {owner ? (
              closed ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    void op({ op: 'group.reopen', groupId }, { said: 'The group is open again.' })
                  }
                >
                  Reopen the group
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setConfirm('close')}>
                  Close the group
                </Button>
              )
            ) : (
              <span className={styles.small}>Only an owner can close the group.</span>
            )}
            {owner && neverUsed ? (
              <Button variant="secondary" onClick={() => setConfirm('delete')}>
                Delete the group
              </Button>
            ) : null}
          </div>
          {owner && !neverUsed ? (
            <p className={styles.small}>
              A group that has had an expense or a payment is closed, not deleted.
            </p>
          ) : null}
        </section>
      </article>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        pending={working}
        destructive={
          confirm === 'delete' ||
          confirm === 'leave' ||
          (typeof confirm === 'object' && confirm !== null)
        }
        title={
          confirm === 'leave'
            ? 'Leave this group?'
            : confirm === 'close'
              ? 'Close this group?'
              : confirm === 'delete'
                ? 'Delete this group?'
                : typeof confirm === 'object' && confirm && 'merge' in confirm
                  ? `Merge ${nameOf(confirm.merge)} into ${confirm.into === view.me?.id ? 'you' : nameOf(confirm.into)}?`
                  : `Remove ${typeof confirm === 'object' && confirm ? nameOf(confirm.remove) : ''}?`
        }
        message={
          confirm === 'leave'
            ? 'You will no longer see it. Your name stays on what you shared.'
            : confirm === 'close'
              ? 'Nothing more can be added. An owner can reopen it.'
              : confirm === 'delete'
                ? 'It goes for good, with everyone in it.'
                : typeof confirm === 'object' && confirm && 'merge' in confirm
                  ? `Everything ${nameOf(confirm.merge)} paid, shared and settled becomes ${whose(confirm.into)}, and ${nameOf(confirm.merge)} leaves the group. This cannot be undone.`
                  : 'They stay on what they shared, shown as left.'
        }
        confirmLabel={
          confirm === 'leave'
            ? 'Leave'
            : confirm === 'close'
              ? 'Close'
              : confirm === 'delete'
                ? 'Delete'
                : typeof confirm === 'object' && confirm && 'merge' in confirm
                  ? 'Merge'
                  : 'Remove'
        }
        onConfirm={() => {
          const which = confirm;
          setWorking(true);
          void (async () => {
            try {
              if (which === 'leave') {
                if (await op({ op: 'member.leave', groupId })) router.push('/groups');
              } else if (which === 'close')
                await op({ op: 'group.close', groupId }, { said: 'The group is closed.' });
              else if (which === 'delete') {
                if (await op({ op: 'group.delete', groupId })) router.push('/groups');
              } else if (which && typeof which === 'object' && 'merge' in which) {
                const answer = await op(
                  {
                    op: 'member.merge',
                    groupId,
                    memberId: which.merge,
                    intoMemberId: which.into,
                  },
                  {
                    said: `${nameOf(which.merge)} is merged into ${which.into === view.me?.id ? 'you' : nameOf(which.into)}.`,
                  },
                );
                if (answer) setMerging(null);
              } else if (which && typeof which === 'object')
                await op(
                  { op: 'member.remove', groupId, memberId: which.remove },
                  { said: `${nameOf(which.remove)} is removed.` },
                );
            } finally {
              setWorking(false);
              setConfirm(null);
            }
          })();
        }}
      />
    </PageContainer>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * **Add people** (DESIGN.md §6.2), one field: typing a name offers the people the reader shares a group with (from the device); an exact email adds the
 * account that has it, or a placeholder with that email; a name alone is added as "not on Tally yet". On an instance with core's directory (§6.2,
 * §14.4), a name of two characters or more also searches it, after a pause in typing, and someone found is added by their `sub`. Without the
 * directory nothing of it shows. Each is `member.add`, online.
 */
interface DirectoryFound {
  sub: string;
  name: string;
  personId: string | null;
}

function AddPeople({
  groupId,
  inGroup,
  add,
  search,
}: {
  groupId: string;
  inGroup: Set<string>;
  add: (body: Record<string, unknown>, said: string) => Promise<unknown>;
  search: (q: string) => Promise<{ available: boolean; people: DirectoryFound[] } | undefined>;
}) {
  const me = useMe();
  const views = useGroupViews();
  const [text, setText] = useState('');
  const typed = text.trim();
  const [found, setFound] = useState<DirectoryFound[]>([]);
  // Core's directory, from two characters, after a pause in typing; never for an email, which Tally looks up itself.
  useEffect(() => {
    setFound([]);
    if (typed.length < 2 || EMAIL.test(typed)) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void search(typed).then((answer) => {
        if (live && answer?.available) setFound(answer.people);
      });
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // `search` is made anew each render; the typed text is what asks again.
  }, [typed]);
  const known = useMemo(() => {
    const out = new Map<string, string>();
    for (const view of views ?? [])
      if (view.group.id !== groupId && view.me)
        for (const m of view.members)
          if (m.personId !== me?.personId && !inGroup.has(m.personId)) out.set(m.personId, m.name);
    return [...out];
  }, [views, groupId, inGroup, me?.personId]);
  const matches = typed
    ? known.filter(([, name]) => name.toLowerCase().includes(typed.toLowerCase())).slice(0, 5)
    : [];
  const isEmail = EMAIL.test(typed);
  const done = async (body: Record<string, unknown>, said: string) => {
    if (await add(body, said)) setText('');
  };
  return (
    <div className={styles.stack}>
      <FormField label="Add people">
        {(field) => (
          <Input
            {...field}
            value={text}
            placeholder="A name or an email"
            maxLength={254}
            onChange={(event) => setText(event.target.value)}
          />
        )}
      </FormField>
      {typed ? (
        <div className={styles.row} role="group" aria-label="Who to add">
          {matches.map(([personId, name]) => (
            <Button
              key={personId}
              variant="secondary"
              size="sm"
              onClick={() => void done({ personId }, `${name} is added.`)}
            >
              Add {name}
            </Button>
          ))}
          {found
            .filter((f) => !(f.personId && inGroup.has(f.personId)) && f.personId !== me?.personId)
            .filter((f) => !matches.some(([personId]) => personId === f.personId))
            .map((f) => (
              <Button
                key={f.sub}
                variant="secondary"
                size="sm"
                aria-label={`Add ${f.name}, from Sovereign`}
                onClick={() => void done({ coreSub: f.sub, name: f.name }, `${f.name} is added.`)}
              >
                Add {f.name} · Sovereign
              </Button>
            ))}
          {isEmail ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void done({ email: typed }, `${typed} is added.`)}
            >
              Add {typed}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void done({ name: typed }, `${typed} is added, not on Tally yet.`)}
            >
              Add “{typed}” as not on Tally yet
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

interface Invited {
  personId: string;
  token: string;
  /** `<epoch>.<secret>`, for the copied link: it opens the group at once. Never sent to the server, never in a mail. */
  fragment: string | null;
  mailed: boolean;
  /** An invitation email went to them less than an hour ago, so this link was not mailed again. */
  mailHeld: boolean;
  mailOn: boolean;
}

/**
 * An invitation just made (DESIGN.md §6.3): the link to copy and send any way at all, and whether an email went too. With no mail set up, it says the
 * link is the only way, rather than pretending an email went. The token is shown once; a new link replaces it.
 */
function InvitationLink({ invitation, name }: { invitation: Invited; name: string }) {
  const link = `${window.location.origin}/invite/${invitation.token}${invitation.fragment ? `#${invitation.fragment}` : ''}`;
  return (
    <span className={styles.stack} role="status" aria-label={`Invitation for ${name}`}>
      <span className={styles.small}>
        {invitation.mailed
          ? `An email is on its way to ${name}. This link opens the group at once, if you send it yourself:`
          : invitation.mailHeld
            ? `An invitation email went to ${name} less than an hour ago, so this new link was not mailed: send it yourself.`
            : invitation.mailOn
              ? `${name} has no email address here: send this link yourself.`
              : 'Mail is not set up here, so this link is the only way: send it to them yourself.'}
      </span>
      <span className={styles.row}>
        <code className={styles.small} style={{ wordBreak: 'break-all' }}>
          {link}
        </code>
        <CopyButton text={link} label="Copy link" copiedLabel="Copied" />
      </span>
      <span className={styles.small}>
        It works once, for 14 days. Whoever has it can take {name}’s place.
      </span>
    </span>
  );
}
