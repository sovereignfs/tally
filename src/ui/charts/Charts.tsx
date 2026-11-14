'use client';

import styles from './Charts.module.css';

/**
 * **Interim charts** (DESIGN.md §13, §15.10), decided by the owner on 2026-11-14 until `@sovereignfs/ui` has charts (14.1), where they are to move:
 * a bar chart (categories, groups, members) and a chart over months, each **with a table of the same figures beside it**. The drawing is hidden from a
 * screen reader, which reads the table; both are in the design system's tokens only, so they follow light and dark. No chart library, nothing loaded.
 */
export interface ChartRow {
  key: string;
  label: string;
  value: number;
  /** The value as it is said, formatted by the caller (an amount in its currency). */
  valueLabel: string;
}

const share = (value: number, max: number) =>
  max > 0 ? `${(Math.max(0, value) / max) * 100}%` : '0%';

function FiguresTable({
  caption,
  head,
  rows,
  total,
}: {
  caption: string;
  head: [string, string];
  rows: readonly ChartRow[];
  total?: string;
}) {
  return (
    <table className={styles.table}>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{head[0]}</th>
          <td>{head[1]}</td>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{row.label}</th>
            <td>{row.valueLabel}</td>
          </tr>
        ))}
      </tbody>
      {total ? (
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td>{total}</td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

/** Bars, largest first as given, each with its label and value; then the table. */
export function BarChart({
  caption,
  head,
  rows,
  total,
}: {
  caption: string;
  head: [string, string];
  rows: readonly ChartRow[];
  total?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <figure className={styles.chart}>
      <ul className={styles.bars} aria-hidden>
        {rows.map((row) => (
          <li key={row.key} className={styles.bar}>
            <span className={styles.label}>{row.label}</span>
            <span className={styles.track}>
              <span
                className={styles.fill}
                style={{ display: 'block', width: share(row.value, max) }}
              />
            </span>
            <span className={styles.value}>{row.valueLabel}</span>
          </li>
        ))}
      </ul>
      <FiguresTable caption={caption} head={head} rows={rows} {...(total ? { total } : {})} />
    </figure>
  );
}

/** Columns over time, oldest first, each labelled short (`short`) under it; then the table with the long labels. */
export function MonthChart({
  caption,
  rows,
  short,
  total,
}: {
  caption: string;
  rows: readonly ChartRow[];
  short: (row: ChartRow) => string;
  total?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <figure className={styles.chart}>
      <div aria-hidden>
        <div className={styles.columns}>
          {rows.map((row) => (
            <div key={row.key} className={styles.column} title={`${row.label}: ${row.valueLabel}`}>
              <div className={styles.columnFill} style={{ height: share(row.value, max) }} />
            </div>
          ))}
        </div>
        <div className={styles.columnLabels}>
          {rows.map((row) => (
            <span key={row.key}>{short(row)}</span>
          ))}
        </div>
      </div>
      <FiguresTable
        caption={caption}
        head={['Month', 'Spent']}
        rows={rows}
        {...(total ? { total } : {})}
      />
    </figure>
  );
}
