import { Coffee, Flame, Pause, Play, RotateCcw, Target, Timer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

import PageHeader from "@/components/app/PageHeader";
import { useCollection, put, useSetting, type FocusSession } from "@/lib/db";
import { ensureNotificationPermission, notify } from "@/lib/notifications";
import { fmtDuration, fmtFullDate, lastNDays, todayKey, uid } from "@/lib/format";

const SHORT = 5 * 60;
const LONG = 15 * 60;

type Mode = "focus" | "short" | "long";

function beep() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    [660, 880].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.35 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.35);
      osc.stop(ctx.currentTime + i * 0.35 + 0.32);
    });
    setTimeout(() => void ctx.close(), 1600);
  } catch {
    /* no audio available */
  }
}

export default function Focus() {
  const [mode, setMode] = useState<Mode>("focus");
  const [focusMin, setFocusMin] = useSetting<number>("focusMinutes", 25);
  const [seconds, setSeconds] = useState(focusMin * 60);
  const [running, setRunning] = useState(false);
  const [task, setTask] = useState("");
  const cycle = useRef(0);
  const finishedRef = useRef(false);

  const sessions = useCollection<FocusSession>("focus");

  const durationOf = (m: Mode) => (m === "focus" ? focusMin * 60 : m === "short" ? SHORT : LONG);

  // Reset the clock whenever the mode or focus length changes.
  useEffect(() => {
    finishedRef.current = false;
    setSeconds(durationOf(mode));
  }, [mode, focusMin]); // eslint-disable-line react-hooks/exhaustive-deps

  const complete = async () => {
    beep();
    if (mode === "focus") {
      const mins = focusMin;
      await put<FocusSession>("focus", {
        id: uid(),
        date: todayKey(),
        task: task.trim() || "Deep work",
        minutes: mins,
        kind: "focus",
        completedAt: Date.now(),
      });
      cycle.current += 1;
      notify("Focus complete", `${mins} focused minutes — well done${task.trim() ? ` · ${task.trim()}` : ""}.`);
      setMode(cycle.current % 4 === 0 ? "long" : "short");
    } else {
      notify("Break over", "Ready for the next focus session?");
      setMode("focus");
    }
  };

  useEffect(() => {
    if (running && seconds <= 0 && !finishedRef.current) {
      finishedRef.current = true;
      setRunning(false);
      void complete();
    }
  }, [seconds, running]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(iv);
  }, [running]);

  const total = durationOf(mode);
  const progress = total > 0 ? seconds / total : 0;
  const today = todayKey();

  const todayMinutes = useMemo(
    () => sessions.filter((s) => s.date === today && s.kind === "focus").reduce((a, s) => a + s.minutes, 0),
    [sessions, today],
  );

  const streak = useMemo(() => {
    const days = new Set(sessions.filter((s) => s.kind === "focus").map((s) => s.date));
    let n = 0;
    const d = new Date();
    if (!days.has(todayKey(d))) d.setDate(d.getDate() - 1);
    while (days.has(todayKey(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }, [sessions]);

  const week = useMemo(
    () =>
      lastNDays(7).map((key) => ({
        day: fmtFullDate(key).split(",")[0],
        minutes: sessions.filter((s) => s.date === key && s.kind === "focus").reduce((a, s) => a + s.minutes, 0),
      })),
    [sessions],
  );

  const recent = useMemo(() => [...sessions].sort((a, b) => b.completedAt - a.completedAt).slice(0, 8), [sessions]);

  const RADIUS = 96;
  const CIRC = 2 * Math.PI * RADIUS;

  return (
    <div>
      <PageHeader
        eyebrow="Focus"
        title="Focus"
        description="Quiet, deliberate time. Sessions are tracked on-device and counted in your stats."
      />

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Timer */}
        <div className="quiet-card flex flex-col items-center p-6 lg:col-span-3">
          <div className="flex gap-1.5">
            {(
              [
                { id: "focus", label: "Focus" },
                { id: "short", label: "Short break" },
                { id: "long", label: "Long break" },
              ] as { id: Mode; label: string }[]
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  if (running && !window.confirm("Switch mode? The current timer will reset.")) return;
                  setMode(m.id);
                  setRunning(false);
                }}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  mode === m.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="What are you focusing on?"
            className="mt-6 w-full max-w-sm rounded-md border bg-transparent px-3 py-2 text-center text-sm outline-none focus:border-foreground/40"
          />

          <div className="relative mt-6">
            <svg viewBox="0 0 220 220" className="h-60 w-60 text-foreground">
              <circle cx="110" cy="110" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="5" className="text-muted" />
              <circle
                cx="110"
                cy="110"
                r={RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={CIRC}
                strokeDashoffset={CIRC * (1 - progress)}
                transform="rotate(-90 110 110)"
                className="transition-[stroke-dashoffset] duration-500"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-5xl font-semibold tracking-tight tabular-nums">{fmtDuration(seconds)}</span>
              <span className="mt-1 text-xs text-muted-foreground">
                {mode === "focus" ? (task.trim() || "Deep work") : mode === "short" ? "Short break" : "Long break"}
              </span>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!running && mode === "focus") void ensureNotificationPermission();
                setRunning((r) => !r);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {running ? "Pause" : seconds === total ? "Start" : "Resume"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRunning(false);
                finishedRef.current = false;
                setSeconds(total);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border px-4 py-2.5 text-sm transition-colors hover:bg-accent"
              title="Reset"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>

          {mode === "focus" && (
            <div className="mt-5 flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Session length</span>
              {[15, 25, 45, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setRunning(false);
                    setFocusMin(m);
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                    focusMin === m ? "bg-foreground text-background" : "border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {m}m
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="quiet-card p-4">
              <p className="microlabel">Today</p>
              <p className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight tabular-nums">
                <Timer className="h-4 w-4 text-muted-foreground" /> {todayMinutes}m
              </p>
            </div>
            <div className="quiet-card p-4">
              <p className="microlabel">Streak</p>
              <p className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight tabular-nums">
                <Flame className="h-4 w-4 text-muted-foreground" /> {streak}d
              </p>
            </div>
          </div>

          <div className="quiet-card p-5">
            <p className="microlabel mb-3">Last 7 days</p>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={week} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: "rgba(128,128,128,0.08)" }}
                    contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid var(--border)" }}
                    formatter={(v) => [`${v} min`, "Focus"]}
                  />
                  <Bar dataKey="minutes" fill="currentColor" className="text-foreground" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="quiet-card p-5">
            <p className="microlabel mb-3">Recent sessions</p>
            {recent.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No sessions yet — start one on the left.</p>
            ) : (
              <ul className="space-y-2">
                {recent.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <Target className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{s.task}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                      {s.minutes}m · {fmtFullDate(s.date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
