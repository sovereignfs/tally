import { toMinor } from '../money/amount';
import { formatMoney } from '../money/text';
import styles from './Screens.module.css';

/**
 * A balance in words (DESIGN.md §4, §10.1): "you owe €63.00", "you are owed €120.00", "settled up", or with a name, "Sam owes you €12.00". In the
 * currency's own decimals: the design system's `BalanceChip` assumes cents, which is wrong for yen and dinars (worth raising in `sovereign`).
 */
export function Balance({
  amount,
  currency,
  who,
}: {
  /** Positive is owed to the subject, negative is what they owe. */
  amount: number;
  currency: string;
  /** Whose balance: the reader, or a person named (their balance with the reader). */
  who?: { name: string };
}) {
  if (amount === 0) return <span className={styles.settled}>settled up</span>;
  const money = formatMoney(toMinor(Math.abs(amount)), currency);
  if (!who)
    return (
      <span className={amount > 0 ? styles.owed : styles.owe}>
        {amount > 0 ? `you are owed ${money}` : `you owe ${money}`}
      </span>
    );
  return (
    <span className={amount > 0 ? styles.owe : styles.owed}>
      {amount > 0 ? `you owe ${who.name} ${money}` : `${who.name} owes you ${money}`}
    </span>
  );
}

export function GroupDot({ color }: { color: string }) {
  return <span className={styles.dot} style={{ background: color }} aria-hidden />;
}
