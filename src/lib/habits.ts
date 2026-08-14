/** Habit scheduling + streak logic, shared so it can be unit-tested. */
import type { Habit, HabitLog } from "./db";
import { todayKey } from "./format";

/** Is this habit due on the given YYYY-MM-DD key? */
export function isHabitDue(h: Habit, key: string): boolean {
  if (h.frequency === "custom") {
    if (h.days.length === 0) return false;
    return h.days.includes(new Date(`${key}T12:00:00`).getDay());
  }
  return true; // daily
}

/**
 * Current streak: consecutive due days completed, ending today or yesterday.
 * `today` is injectable for tests; it defaults to the real date.
 */
export function habitStreak(h: Habit, logs: Map<string, HabitLog[]>, today: Date = new Date()): number {
  const done = new Set((logs.get(h.id) ?? []).map((l) => l.date));
  const d = new Date(today);
  // Today not checked off yet? Count through yesterday so the streak isn't
  // wiped first thing in the morning.
  if (!done.has(todayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  let guard = 0;
  while (guard++ < 500) {
    const key = todayKey(d);
    if (!isHabitDue(h, key)) {
      d.setDate(d.getDate() - 1);
      continue;
    }
    if (!done.has(key)) break;
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
