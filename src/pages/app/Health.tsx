import { Activity, BedDouble, Droplets, Plus, Scale, Utensils } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import PageHeader from "@/components/app/PageHeader";
import { useCollection, put, type HealthEntry, type HealthType } from "@/lib/db";
import { lastNDays, todayKey, uid, fmtFullDate } from "@/lib/format";

const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack"];
const EXERCISE = ["Walk", "Run", "Cycle", "Gym", "Yoga", "Swim", "Other"];
const TYPES: { value: HealthType; label: string; icon: typeof BedDouble }[] = [
  { value: "sleep", label: "Sleep", icon: BedDouble },
  { value: "weight", label: "Weight", icon: Scale },
  { value: "exercise", label: "Exercise", icon: Activity },
  { value: "water", label: "Water", icon: Droplets },
  { value: "meal", label: "Meal", icon: Utensils },
];

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="quiet-card p-4">
      <p className="microlabel">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function Health() {
  const entries = useCollection<HealthEntry>("health");
  const [type, setType] = useState<HealthType>("sleep");
  const today = todayKey();

  // Form state per type.
  const [date, setDate] = useState(today);
  const [hours, setHours] = useState(7);
  const [quality, setQuality] = useState(3);
  const [kg, setKg] = useState("");
  const [kind, setKind] = useState("Walk");
  const [minutes, setMinutes] = useState(30);
  const [meal, setMeal] = useState("Lunch");
  const [food, setFood] = useState("");
  const [kcal, setKcal] = useState("");
  const [glasses, setGlasses] = useState(0);

  const log = async () => {
    const entry: HealthEntry = {
      id: uid(),
      date,
      type,
      data: {},
      createdAt: Date.now(),
    };
    if (type === "sleep") {
      entry.data = { hours, quality };
    } else if (type === "weight") {
      const v = Number(kg);
      if (!v) return toast("Enter a weight");
      entry.data = { kg: v };
      setKg("");
    } else if (type === "exercise") {
      entry.data = { kind, minutes };
    } else if (type === "water") {
      const total = glasses > 0 ? glasses * 250 : 250;
      entry.data = { ml: total };
      setGlasses(0);
    } else if (type === "meal") {
      if (!food.trim()) return toast("Describe the meal");
      entry.data = { meal, food: food.trim(), kcal: Number(kcal) || 0 };
      setFood("");
      setKcal("");
    }
    await put("health", entry);
    toast("Logged");
  };

  const byDay = useMemo(() => {
    const days = lastNDays(14);
    return days.map((d) => {
      const day = entries.filter((e) => e.date === d);
      const sleep = day.filter((e) => e.type === "sleep");
      const sleepHours = sleep.reduce((s, e) => s + Number(e.data.hours || 0), 0);
      const sleepAvg = sleep.length ? sleepHours / sleep.length : null;
      const water = day.filter((e) => e.type === "water").reduce((s, e) => s + Number(e.data.ml || 0), 0);
      const exercise = day.filter((e) => e.type === "exercise").reduce((s, e) => s + Number(e.data.minutes || 0), 0);
      const weights = day.filter((e) => e.type === "weight");
      const weight = weights.length ? Number(weights[weights.length - 1].data.kg || 0) : null;
      const meals = day.filter((e) => e.type === "meal");
      const kcalTotal = meals.reduce((s, e) => s + Number(e.data.kcal || 0), 0);
      return {
        day: d.slice(5),
        sleep: sleepAvg === null ? null : Math.round(sleepAvg * 10) / 10,
        water,
        exercise,
        weight,
        kcal: kcalTotal,
      };
    });
  }, [entries]);

  const week = byDay.slice(-7);
  const todayRow = byDay[byDay.length - 1];

  const totals = useMemo(() => {
    const sleep7 = byDay.slice(-7).filter((d) => d.sleep !== null);
    const sleepAvg = sleep7.length ? sleep7.reduce((s, d) => s + (d.sleep ?? 0), 0) / sleep7.length : 0;
    const exerciseWeek = week.reduce((s, d) => s + d.exercise, 0);
    const lastWeight = [...byDay].reverse().find((d) => d.weight !== null)?.weight ?? null;
    const firstWeight = byDay.find((d) => d.weight !== null)?.weight ?? null;
    return {
      sleepAvg,
      exerciseWeek,
      lastWeight,
      weightDelta: lastWeight !== null && firstWeight !== null ? lastWeight - firstWeight : null,
    };
  }, [byDay, week]);

  return (
    <div>
      <PageHeader
        eyebrow="Wellness"
        title="Health"
        description="Track sleep, weight, movement, water and meals — stats computed on this device."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Sleep · 7d avg"
          value={totals.sleepAvg ? `${totals.sleepAvg.toFixed(1)}h` : "—"}
          sub="per night"
        />
        <Stat
          label="Exercise · 7d"
          value={`${totals.exerciseWeek} min`}
          sub="total this week"
        />
        <Stat
          label="Weight"
          value={totals.lastWeight !== null ? `${totals.lastWeight} kg` : "—"}
          sub={totals.weightDelta !== null && totals.weightDelta !== 0 ? `${totals.weightDelta > 0 ? "+" : ""}${totals.weightDelta.toFixed(1)} kg over 14d` : "log daily"}
        />
        <Stat label="Water today" value={`${todayRow?.water ?? 0} ml`} sub={`${Math.round((todayRow?.water ?? 0) / 250)} glasses`} />
      </div>

      {/* Log panel */}
      <div className="quiet-card mt-6 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                type === t.value ? "bg-foreground text-background" : "hover:bg-accent"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <p className="microlabel mb-1">Date</p>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
          </div>

          {type === "sleep" && (
            <>
              <div className="w-48">
                <p className="microlabel mb-1">Hours slept · {hours}h</p>
                <input type="range" min={1} max={12} step={0.5} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="w-full" />
              </div>
              <div className="w-48">
                <p className="microlabel mb-1">Quality · {quality}/5</p>
                <input type="range" min={1} max={5} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="w-full" />
              </div>
            </>
          )}

          {type === "weight" && (
            <input
              value={kg}
              onChange={(e) => setKg(e.target.value)}
              placeholder="Weight in kg"
              inputMode="decimal"
              className="w-40 rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
          )}

          {type === "exercise" && (
            <>
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm outline-none">
                {EXERCISE.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <div className="w-48">
                <p className="microlabel mb-1">Minutes · {minutes}</p>
                <input type="range" min={5} max={240} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-full" />
              </div>
            </>
          )}

          {type === "water" && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGlasses((g) => Math.max(0, g - 1))}
                className="rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                −
              </button>
              <p className="w-24 text-center text-sm">
                {glasses > 0 ? `${glasses}× 250ml already` : "+ 250ml glass"}
              </p>
              <button
                type="button"
                onClick={() => setGlasses((g) => g + 1)}
                className="rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                +
              </button>
            </div>
          )}

          {type === "meal" && (
            <>
              <select value={meal} onChange={(e) => setMeal(e.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm outline-none">
                {MEALS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <input
                value={food}
                onChange={(e) => setFood(e.target.value)}
                placeholder="What did you eat?"
                className="w-56 rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
              <input
                value={kcal}
                onChange={(e) => setKcal(e.target.value)}
                placeholder="kcal (optional)"
                inputMode="numeric"
                className="w-32 rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
            </>
          )}

          <button
            type="button"
            onClick={() => void log()}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Log
          </button>
        </div>
      </div>

      {/* Charts */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="quiet-card p-5">
          <p className="microlabel">Sleep · last 14 days</p>
          <div className="mt-4 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={byDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                <YAxis domain={[0, 12]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={28} />
                <Tooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: "var(--muted-foreground)" }}
                  formatter={(v) => [`${v}h`, "Sleep"]}
                />
                <Line type="monotone" dataKey="sleep" stroke="var(--chart-2)" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="quiet-card p-5">
          <p className="microlabel">Weight · last 14 days</p>
          <div className="mt-4 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={byDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={34} />
                <Tooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: "var(--muted-foreground)" }}
                  formatter={(v) => [`${v} kg`, "Weight"]}
                />
                <Line type="monotone" dataKey="weight" stroke="var(--chart-1)" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="quiet-card p-5">
          <p className="microlabel">Water · last 14 days</p>
          <div className="mt-4 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={34} />
                <Tooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: "var(--muted-foreground)" }}
                  formatter={(v) => [`${v} ml`, "Water"]}
                />
                <Bar dataKey="water" fill="var(--chart-5)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="quiet-card p-5">
          <p className="microlabel">Exercise · last 14 days</p>
          <div className="mt-4 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={34} />
                <Tooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: "var(--muted-foreground)" }}
                  formatter={(v) => [`${v} min`, "Exercise"]}
                />
                <Bar dataKey="exercise" fill="var(--chart-2)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent meals */}
      <div className="mt-6">
        <p className="microlabel mb-3">Recent meals</p>
        <div className="space-y-1.5">
          {entries
            .filter((e) => e.type === "meal")
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .slice(0, 10)
            .map((e) => (
              <div key={e.id} className="quiet-card flex items-center justify-between p-3">
                <div>
                  <p className="text-sm font-medium">
                    {e.data.meal as string} · {e.data.food as string}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{fmtFullDate(e.date)}</p>
                </div>
                {Number(e.data.kcal) > 0 && (
                  <span className="font-mono text-sm text-muted-foreground tabular-nums">{e.data.kcal} kcal</span>
                )}
              </div>
            ))}
          {entries.filter((e) => e.type === "meal").length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No meals logged yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
