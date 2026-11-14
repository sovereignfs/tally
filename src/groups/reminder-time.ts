/**
 * **When a reminder may go again** (DESIGN.md §12.4): once a day per (who reminds, who is reminded, group), the day in UTC. Pure, shared by the server,
 * which holds it, and the button, which shows the wait.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** The start of the next day, in UTC. */
export const nextReminderAt = (now: number) => Date.parse(`${dayOf(now)}T00:00:00Z`) + DAY_MS;

/** "in 5 hours", "in 40 minutes": the wait until the next reminder may go. */
export function waitWords(now: number): string {
  const minutes = Math.max(1, Math.ceil((nextReminderAt(now) - now) / 60_000));
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}
