import { ChevronLeft, ChevronRight, Plus, Trash2, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import { useCollection, put, remove, type Budget, type Transaction } from "@/lib/db";
import { fmtFullDate, todayKey, uid } from "@/lib/format";

export const CATEGORIES = ["Food", "Transport", "Housing", "Utilities", "Health", "Shopping", "Fun", "Work", "Other"] as const;

const PIE_COLORS = ["#0f0f0f", "#525252", "#8a8a8a", "#b5b5b5", "#3f3f3f", "#6b6b6b", "#a1a1a1", "#27272a", "#71717a"];

const money = (n: number) =>
  new Intl.NumberFormat([], { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString([], { month: "long", year: "numeric" });
}

export default function Finance() {
  const now = new Date();
  const [monthKey, setMonthKey] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [category, setCategory] = useState<string>("Food");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayKey());

  const transactions = useCollection<Transaction>("transactions");
  const budgets = useCollection<Budget>("budgets");

  const monthTx = useMemo(
    () => transactions.filter((t) => t.date.startsWith(monthKey)).sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1)),
    [transactions, monthKey],
  );

  const income = monthTx.filter((t) => t.kind === "income").reduce((a, t) => a + t.amount, 0);
  const expense = monthTx.filter((t) => t.kind === "expense").reduce((a, t) => a + t.amount, 0);
  const balance = income - expense;

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of monthTx) {
      if (t.kind !== "expense") continue;
      map.set(t.category, (map.get(t.category) ?? 0) + t.amount);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [monthTx]);

  const addTx = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return toast("Enter a valid amount");
    await put<Transaction>("transactions", {
      id: uid(),
      date,
      amount: amt,
      kind,
      category,
      note: note.trim(),
      createdAt: Date.now(),
    });
    setAmount("");
    setNote("");
    toast("Logged");
  };

  const setBudget = async (cat: string, value: string) => {
    const amt = Number(value);
    if (!Number.isFinite(amt) || amt < 0) return;
    const existing = budgets.find((b) => b.category === cat);
    if (amt === 0) {
      if (existing) await remove("budgets", existing.id);
      return;
    }
    await put<Budget>("budgets", { id: existing?.id ?? uid(), category: cat, monthly: amt });
  };

  const shiftMonth = (dir: number) => {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setMonthKey(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const inputCls = "rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40";

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Finance"
        description="Your money, on your device. No bank connection, no cloud — just the numbers you enter."
      />

      {/* Month nav + summary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => shiftMonth(-1)} className="flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-36 text-center text-sm font-medium">{monthLabel(monthKey)}</span>
          <button type="button" onClick={() => shiftMonth(1)} className="flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {monthKey !== `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}` && (
          <button
            type="button"
            onClick={() => setMonthKey(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`)}
            className="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
          >
            This month
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="quiet-card p-4">
          <p className="microlabel">Income</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{money(income)}</p>
        </div>
        <div className="quiet-card p-4">
          <p className="microlabel">Spent</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{money(expense)}</p>
        </div>
        <div className="quiet-card p-4">
          <p className="microlabel">Balance</p>
          <p className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${balance < 0 ? "text-destructive" : ""}`}>
            {money(balance)}
          </p>
        </div>
        <div className="quiet-card p-4">
          <p className="microlabel">Transactions</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{monthTx.length}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* Breakdown */}
        <div className="quiet-card p-5">
          <p className="microlabel mb-3">Where it went</p>
          {byCategory.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No expenses this month.</p>
          ) : (
            <>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byCategory.map(([name, value]) => ({ name, value }))} dataKey="value" nameKey="name" innerRadius={38} outerRadius={70} paddingAngle={2} strokeWidth={0}>
                      {byCategory.map(([name], i) => (
                        <Cell key={name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => money(Number(v))}
                      contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid var(--border)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-3 space-y-1.5">
                {byCategory.map(([name, value], i) => (
                  <li key={name} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                      {name}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">{money(value)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Budgets */}
        <div className="quiet-card p-5">
          <p className="microlabel mb-3">Budgets</p>
          <div className="space-y-3">
            {CATEGORIES.map((cat) => {
              const budget = budgets.find((b) => b.category === cat);
              const spent = byCategory.find(([name]) => name === cat)?.[1] ?? 0;
              const limit = budget?.monthly ?? 0;
              const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{cat}</span>
                    <div className="flex items-center gap-2">
                      {limit > 0 ? (
                        <span className={`font-mono text-xs tabular-nums ${spent > limit ? "text-destructive" : "text-muted-foreground"}`}>
                          {money(spent)} / {money(limit)}
                        </span>
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground">{money(spent)}</span>
                      )}
                      <input
                        type="number"
                        min={0}
                        defaultValue={limit || ""}
                        placeholder="budget"
                        onBlur={(e) => void setBudget(cat, e.target.value)}
                        className="w-20 rounded-md border bg-transparent px-2 py-1 text-right font-mono text-xs outline-none focus:border-foreground/40"
                      />
                    </div>
                  </div>
                  {limit > 0 && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full transition-all ${spent > limit ? "bg-destructive" : "bg-foreground"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            <p className="pt-1 text-[11px] text-muted-foreground">Set a number in any row to start a monthly budget; clear to remove.</p>
          </div>
        </div>

        {/* Add + list */}
        <div className="space-y-4">
          <div className="quiet-card p-5">
            <p className="microlabel mb-3">Add entry</p>
            <div className="space-y-2">
              <div className="flex gap-1.5">
                {(["expense", "income"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${
                      kind === k ? "bg-foreground text-background" : "border text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${inputCls} w-28 font-mono`} />
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputCls} flex-1`}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={inputCls} />
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} w-full`} />
              <button
                type="button"
                onClick={() => void addTx()}
                disabled={!amount}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" /> Log {kind}
              </button>
            </div>
          </div>

          <div className="quiet-card p-5">
            <p className="microlabel mb-3">This month</p>
            {monthTx.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">Nothing logged yet.</p>
            ) : (
              <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
                {monthTx.map((t) => (
                  <li key={t.id} className="group flex items-center gap-3 rounded-md px-1.5 py-2 transition-colors hover:bg-accent/30">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {t.note || t.category}
                        {t.kind === "income" && <span className="ml-1.5 text-[10px] text-muted-foreground">income</span>}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {t.category} · {fmtFullDate(t.date)}
                      </span>
                    </span>
                    <span className={`font-mono text-sm tabular-nums ${t.kind === "expense" ? "" : "text-foreground"}`}>
                      {t.kind === "expense" ? "−" : "+"}{money(t.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void remove("transactions", t.id)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Wallet className="h-3 w-3" /> Stored only on this device. Use the encrypted backup in Settings to carry it to a new phone.
      </div>
    </div>
  );
}
