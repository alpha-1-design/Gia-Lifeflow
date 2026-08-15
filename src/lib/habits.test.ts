import { describe, expect, it } from "vitest";
import type { Habit, HabitLog } from "./db";
import { habitStreak, isHabitDue } from "./habits";

// Fixed "today" so the tests never depend on the real date.
const TODAY = new Date(2026, 7, 14); // Friday, 2026-08-14

function habit(over: Partial<Habit> = {}): Habit {
  return { id: "h1", name: "Read", frequency: "daily", days: [], routine: "Any", color: "#000", createdAt: 0, archived: false, ...over };
}

function logs(entries: string[]): Map<string, HabitLog[]> {
  const map = new Map<string, HabitLog[]>();
  map.set(
    "h1",
    entries.map((date) => ({ id: date, habitId: "h1", date, completedAt: 0 })),
  );
  return map;
}

describe("isHabitDue", () => {
  it("daily habits are due every day", () => {
    expect(isHabitDue(habit(), "2026-08-14")).toBe(true);
  });
  it("custom habits are due only on chosen weekdays", () => {
    const h = habit({ frequency: "custom", days: [1, 3] }); // Mon, Wed
    // 2026-08-14 is a Friday
    expect(isHabitDue(h, "2026-08-14")).toBe(false);
    // 2026-08-17 is a Monday
    expect(isHabitDue(h, "2026-08-17")).toBe(true);
  });
  it("custom habits with no days are never due", () => {
    expect(isHabitDue(habit({ frequency: "custom", days: [] }), "2026-08-17")).toBe(false);
  });
});

describe("habitStreak", () => {
  it("counts consecutive completed days", () => {
    const h = habit();
    // Log today and yesterday (2026-08-14 and 08-13)
    expect(habitStreak(h, logs(["2026-08-14", "2026-08-13"]), TODAY)).toBe(2);
  });
  it("returns 0 when today and yesterday were both missed", () => {
    // only the day before yesterday is logged
    expect(habitStreak(habit(), logs(["2026-08-12"]), TODAY)).toBe(0);
  });
  it("keeps the streak through yesterday when today is not done yet", () => {
    // yesterday done, today pending — streak survives
    expect(habitStreak(habit(), logs(["2026-08-13"]), TODAY)).toBe(1);
  });
  it("still counts through yesterday when today is not yet done", () => {
    const h = habit();
    // yesterday done, today not → streak continues from yesterday
    expect(habitStreak(h, logs(["2026-08-13", "2026-08-12"]), TODAY)).toBe(2);
  });
  it("breaks the streak on a missed due day", () => {
    // done today and two days ago, missed yesterday
    expect(habitStreak(habit(), logs(["2026-08-14", "2026-08-12"]), TODAY)).toBe(1);
  });
  it("skips non-due days for custom habits", () => {
    const h = habit({ frequency: "custom", days: [0, 1, 2, 3, 4, 5, 6] });
    expect(habitStreak(h, logs(["2026-08-14", "2026-08-13", "2026-08-12"]), TODAY)).toBe(3);
  });
});
