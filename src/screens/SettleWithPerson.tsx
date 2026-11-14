'use client';

import { useState } from 'react';
import { Button, ConfirmDialog } from '@sovereignfs/ui';
import { addPayment } from '../actions';
import { settleWithPerson } from '../balances/across';
import { formatMoney } from '../money/text';
import { useSync } from '../sync/react';
import { type PersonView, sharedGroups } from './data';
import { useGroupNames } from './hooks';

/**
 * **Settle up with a person** (DESIGN.md §9): behind one confirmation, one payment for every group and currency in which the two have a balance, exactly
 * as if each group had been settled in turn (`settleWithPerson`). There is no payment across groups in the data. Each is written to the device.
 */
export function SettleWithPerson({
  person,
  label = 'Settle up',
}: {
  person: PersonView;
  label?: string;
}) {
  const client = useSync();
  const names = useGroupNames(person.groups.map((g) => g.view.group));
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const payments = settleWithPerson(sharedGroups(person));
  if (payments.length === 0) return null;
  const said = (p: (typeof payments)[number]) => {
    const group = person.groups.find((g) => g.view.group.id === p.groupId);
    const from = p.fromMemberId === group?.me ? 'You pay' : `${person.name} pays you`;
    return `${from} ${p.fromMemberId === group?.me ? person.name : ''} ${formatMoney(p.amount, p.currency)} in ${names[p.groupId] ?? 'a group'}`.replace(
      /\s+/g,
      ' ',
    );
  };
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label={`${label} with ${person.name}`}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Settle up with ${person.name}?`}
        message={
          <>
            <p>
              This records {payments.length === 1 ? 'one payment' : `${payments.length} payments`},
              one in each group and currency:
            </p>
            <ul>
              {payments.map((p) => (
                <li key={`${p.groupId}:${p.currency}`}>{said(p)}</li>
              ))}
            </ul>
            <p>Nothing moves money: it records that it was paid.</p>
          </>
        }
        confirmLabel={payments.length === 1 ? 'Record the payment' : 'Record the payments'}
        pending={working}
        onConfirm={() => {
          if (!client) return;
          setWorking(true);
          void (async () => {
            try {
              for (const p of payments)
                await client.commit(
                  addPayment({
                    mutationId: crypto.randomUUID(),
                    groupId: p.groupId,
                    paymentId: crypto.randomUUID(),
                    row: {
                      sealed: null,
                      fromMemberId: p.fromMemberId,
                      toMemberId: p.toMemberId,
                      amount: p.amount,
                      currency: p.currency,
                      date: new Date().toISOString().slice(0, 10),
                    },
                  }),
                );
              setOpen(false);
            } finally {
              setWorking(false);
            }
          })();
        }}
      />
    </>
  );
}
