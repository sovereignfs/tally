'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@sovereignfs/ui';
import type { Minor } from '../money/amount';
import { currencyDecimals } from '../money/currencies';
import { decimalText, parseAmount } from '../money/text';

/**
 * **An amount typed in a currency's own minor unit** (DESIGN.md §8.7, §15.9): the text a person types is parsed exactly, through decimal text and never a
 * float (`parseAmount`), with as many decimals as the currency has (none for JPY, three for BHD) and anything more refused rather than rounded. It
 * reports minor units, or `null` while the text is not an amount. **An interim of Tally's** (task 14.4): the published `CurrencyInput` parses through
 * floating point; this is to move to `@sovereignfs/ui` and be replaced by the release.
 *
 * Keeps its own text while typing, so that "12." is not reformatted under the cursor, and takes a new value from outside only when it is not the one
 * the text already says.
 */
export function MoneyInput({
  id,
  value,
  onChange,
  currency,
  'aria-label': label,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  focusOnOpen,
}: {
  id?: string;
  value: Minor | null;
  onChange: (value: Minor | null) => void;
  currency: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  /** Focused when it first appears: the amount is the first thing typed (§15.9). */
  focusOnOpen?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusOnOpen) return;
    // After the sheet or drawer around it has placed its own focus, which it does as it opens.
    const handle = window.setTimeout(() => ref.current?.focus(), 80);
    return () => window.clearTimeout(handle);
  }, [focusOnOpen]);
  const [text, setText] = useState(value === null ? '' : decimalText(value, currency));
  const shownCurrency = useRef(currency);
  useEffect(() => {
    if (shownCurrency.current !== currency) {
      // A new currency: what was typed stays as typed, and is read in it ("1000" in euros is ¥1,000, not ¥100,000).
      shownCurrency.current = currency;
      const reread = parseAmount(text, currency);
      if (reread !== value) onChange(reread);
      return;
    }
    // A new value from outside (a prefill, a reset): shown, unless the text already says it. Typing changes `text` and reports through `onChange`.
    if (parseAmount(text, currency) !== value)
      setText(value === null ? '' : decimalText(value, currency));
  }, [value, currency]);
  const decimals = currencyDecimals(currency);
  return (
    <Input
      {...(id ? { id } : {})}
      type="text"
      inputMode={decimals === 0 ? 'numeric' : 'decimal'}
      autoComplete="off"
      value={text}
      placeholder={decimals === 0 ? '0' : `0.${'0'.repeat(decimals)}`}
      {...(label ? { 'aria-label': label } : {})}
      {...(describedBy ? { 'aria-describedby': describedBy } : {})}
      {...(invalid ? { 'aria-invalid': true } : {})}
      ref={ref}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseAmount(event.target.value, currency));
      }}
    />
  );
}
