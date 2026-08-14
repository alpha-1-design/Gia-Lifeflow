import { Check, Flame, Plus, Repeat, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import { useCollection, put, remove, type Habit, type HabitLog } from "@/lib/db";
import { fmtFullDate, todayKey, uid } from "@/lib/format";

const COLORS = ["#0f0f0f", "#525252", "#8a8a8a", "#6b7280", "#3f3f3f"];
const ROUTINES = ["Morning", "Evening", "Any"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HEAT_DAYS = 84; // 12 weeks

function isDue(h: Habit, key: string): boolean {
  if (h.frequency === "custom") {
    if (h.days.length === 0) return false;
    return h.days.includes(new Date(`${key}T12:00:00`).getDay());
  }
  return true; // daily
}

function habitStreak(h: Habit, logs: Map<string, HabitLog[]>): number {
  const done = new Set((logs.get(h.id) ?? []).map((l) => l.date));
  const d = new Date();
  if (isDue(h, todayKey(d)) && !done.has(todayKey(d))) return 0;
  if (!done.has(todayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  let guard = 0;
  while (guard++ < 500) {
    const key = todayKey(d);
    if (!isDue(h, key)) {
      d.setDate(d.getDate() - 1);
      continue;
    }
    if (!done.has(key)) break;
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export default function Habits() {
  const habits = useCollection<Habit>("habits");
  const logs = useCollection<HabitLog>("habitLogs");

  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<"daily" | "custom">("daily");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [routine, setRoutine] = useState<(typeof ROUTINES)[number]>("Any");
  const [color, setColor] = useState(COLORS[0]);

  const logMap = useMemo(() => {
    const map = new Map<string, HabitLog[]>();
    for (const l of logs) {
      const arr = map.get(l.habitId) ?? [];
      arr.push(l);
      map.set(l.habitId, arr);
    }
    return map;
  }, [logs]);

  const today = todayKey();

  const addHabit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return toast("Give the habit a name");
    await put<Habit>("habits", {
      id: uid(),
      name: trimmed,
      frequency,
      days: frequency === "custom" ? days : [],
      routine,
      color,
      createdAt: Date.now(),
      archived: false,
    });
    setName("");
    toast("Habit added");
  };

  const toggleToday = async (h: Habit) => {
    const existing = (logMap.get(h.id) ?? []).find((l) => l.date === today);
    if (existing) await remove("habitLogs", existing.id);
    else
      await put<HabitLog>("habitLogs", {
        id: uid(),
        habitId: h.id,
        date: today,
        completedAt: Date.now(),
      });
  };

  const removeHabit = async (h: Habit) => {
    if (!window.confirm(`Delete "${h.name}" and its history?`)) return;
    for (const l of logMap.get(h.id) ?? []) await remove("habitLogs", l.id);
    await remove("habits", h.id);
  };

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  // heat cells: oldest -> newest, 7 per week column
  const heatCells = useMemo(() => {
    const out: { key: string; date: Date }[] = [];
    for (let i = HEAT_DAYS - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push({ key: todayKey(d), date: d });
    }
    return out;
  }, []);

  const grouped = useMemo(
    () =>
      (ROUTINES as readonly string[]).map((r) => ({
        routine: r,
        items: habits
          .filter((h) => h.routine === r && !h.archived)
          .sort((a, b) => a.createdAt - b.createdAt),
      })),
    [habits],
  );

  const inputCls = "rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40";

  return (
    <div>
      <PageHeader
        eyebrow="Habits"
        title="Habits & routines"
        description="Small commitments, quietly kept. Everything stays on this device."
      />

      {/* Add */}
      <div className="quiet-card p-5">
        <p className="microlabel mb-3">New habit</p>
        <div className="flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Read 20 minutes" className={`${inputCls} w-56`} />
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as "daily" | "custom")} className={inputCls}>
            <option value="daily">Every day</option>
            <option value="custom">Certain days</option>
          </select>
          <select value={routine} onChange={(e) => setRoutine(e.target.value as (typeof ROUTINES)[number])} className={inputCls}>
            {ROUTINES.map((r) => (
              <option key={r} value={r}>{r} routine</option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-5 w-5 rounded-full transition-transform ${color === c ? "scale-110 ring-2 ring-foreground/40 ring-offset-2 ring-offset-background" : ""}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => void addHabit()}
            disabled={!name.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
        {frequency === "custom" && (
          <div className="mt-3 flex items-center gap-1.5">
            {WEEKDAYS.map((w, i) => (
              <button
                key={w}
                type="button"
                onClick={() => toggleDay(i)}
                className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  days.includes(i) ? "bg-foreground text-background" : "border text-muted-foreground hover:bg-accent"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lists */}
      <div className="mt-5 space-y-6">
        {grouped.map(({ routine: r, items }) =>
          items.length === 0 ? null : (
            <section key={r}>
              <p className="microlabel mb-2">{r}</p>
              <div className="space-y-2">
                {items.map((h) => {
                  const doneToday = (logMap.get(h.id) ?? []).some((l) => l.date === today);
                  const streak = habitStreak(h, logMap);
                  return (
                    <div key={h.id} className="quiet-card flex flex-wrap items-center gap-4 p-4">
                      <button
                        type="button"
                        onClick={() => void toggleToday(h)}
                        title={doneToday ? "Mark not done" : "Mark done today"}
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                          doneToday ? "border-transparent text-background" : "border-muted text-transparent hover:border-foreground/40"
                        }`}
                        style={doneToday ? { backgroundColor: h.color } : undefined}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{h.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {h.frequency === "custom" ? h.days.map((d) => WEEKDAYS[d]).join(" · ") : "Every day"} ·{" "}
                          {h.routine !== "Any" ? `${h.routine.toLowerCase()} routine` : "anytime"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground tabular-nums">
                          <Flame className="h-3.5 w-3.5" /> {streak}d
                        </span>
                        <div className="hidden gap-[3px] sm:grid sm:grid-flow-col sm:grid-rows-7">
                          {heatCells.map(({ key }) => {
                            const logged = (logMap.get(h.id) ?? []).some((l) => l.date === key);
                            const isToday = key === today;
                            return (
                              <span
                                key={key}
                                title={fmtFullDate(key)}
                                className={`h-[7px] w-[7px] rounded-[2px] ${isToday ? "ring-1 ring-foreground/60" : ""}`}
                                style={{ backgroundColor: logged ? h.color : "var(--muted)" }}
                              />
                            );
                          })}
                        </div>
                        <button
                          type="button"
                          onClick={() => void removeHabit(h)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ),
        )}
        {habits.length === 0 && (
          <div className="quiet-card flex flex-col items-center p-12 text-center">
            <Repeat className="h-6 w-6 text-muted-foreground/50" />
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              No habits yet. Add one above — daily or on specific days, with a morning or evening routine.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
