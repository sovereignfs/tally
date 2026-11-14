'use client';

import { useMemo } from 'react';
import { Combobox } from '@sovereignfs/ui';
import { CURRENCY_OPTIONS } from '../money/currencies';

/**
 * **A searchable currency picker** (DESIGN.md §8.7, §15.9), with the person's own currencies first: their primary currency, the group's, and those
 * recently used. **An interim of Tally's** (task 14.4): it is to move to `@sovereignfs/ui`, where `MoneyInput` and a picker belong, and be replaced here
 * by the release. Built only on the published `Combobox`.
 */
export function CurrencyPicker({
  value,
  onChange,
  first = [],
  'aria-label': label = 'Currency',
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  /** Codes to list first, in this order. */
  first?: readonly string[];
  'aria-label'?: string;
  disabled?: boolean;
}) {
  const options = useMemo(() => {
    const top = [...new Set(first)].filter((code) => CURRENCY_OPTIONS.some((c) => c.code === code));
    const rest = CURRENCY_OPTIONS.filter((c) => !top.includes(c.code));
    const chosen = top.flatMap((code) => CURRENCY_OPTIONS.filter((c) => c.code === code));
    return [...chosen, ...rest].map((c) => ({
      value: c.code,
      label: `${c.code} · ${c.name}`,
    }));
  }, [first]);
  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      aria-label={label}
      searchPlaceholder="Search currencies"
      emptyMessage="No currency by that name"
      {...(disabled ? { disabled } : {})}
    />
  );
}
