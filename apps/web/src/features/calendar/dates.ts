/** Calendar-day helpers. A day is a local calendar day written YYYY-MM-DD; no time zones in here. */

const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local noon of a day key: far from midnight, so adding days never trips over a clock change. */
export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
}

export function addDays(key: string, days: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + days);
  return dayKey(d);
}

/** Whole days from one day to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((fromKey(to).getTime() - fromKey(from).getTime()) / 86_400_000);
}

/** "2026-11" for a month, and the month `by` months away. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function addMonths(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return monthKey(new Date(y, m - 1 + by, 1, 12));
}

/**
 * The weeks a month's page shows: whole weeks from Sunday, covering the month, so four to six rows.
 * Each cell is a day key; `inMonth` says whether it belongs to the month itself.
 */
export function monthGrid(month: string): Array<Array<{ key: string; inMonth: boolean }>> {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(y, m - 1, 1, 12);
  const start = addDays(dayKey(first), -first.getDay());
  const lastDay = new Date(y, m, 0, 12);
  const end = addDays(dayKey(lastDay), 6 - lastDay.getDay());
  const weeks: Array<Array<{ key: string; inMonth: boolean }>> = [];
  let cursor = start;
  while (cursor <= end) {
    const week: Array<{ key: string; inMonth: boolean }> = [];
    for (let i = 0; i < 7; i++) {
      week.push({ key: cursor, inMonth: cursor.slice(0, 7) === month });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function monthTitle(month: string): string {
  return fromKey(`${month}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
export function longDay(key: string): string {
  return fromKey(key).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** "today", "tomorrow", "in 5 days", "yesterday", "3 days ago". */
export function relativeDay(today: string, key: string): string {
  const n = daysBetween(today, key);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** How busy a study day was, 0 (nothing) to 3, for the cell's tint. */
export function studyLevel(day: { answered: number; notes: Array<{ edits: number }> } | undefined) {
  if (!day) return 0;
  const score = day.answered + day.notes.reduce((n, d) => n + d.edits, 0) * 2;
  return score === 0 ? 0 : score < 10 ? 1 : score < 30 ? 2 : 3;
}
