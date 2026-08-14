/**
 * Lifeflow AI companion.
 *
 * Calls an OpenAI-compatible `/chat/completions` endpoint directly from the
 * device with the key you provide (OpenAI, Groq, OpenRouter, Together, a local
 * model server — any compatible base URL works). The key is stored only in
 * this device's local storage and is sent only to the endpoint you configure.
 * When offline, or when no key is set, everything falls back to deterministic
 * on-device summaries — the app never depends on the network.
 */
import { db, getAll, getSetting, setSetting, type AiMessage } from "./db";
import { fetchGithubStats, fetchNewsList, fetchWeather } from "./clients";
import { greeting, todayKey } from "./format";

export interface AiConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  apiKey: "",
  baseUrl: "https://openrouter.ai/api/v1",
  model: "openrouter/auto",
};

/** One-click provider presets (all OpenAI-compatible chat completions). */
export const AI_PROVIDERS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openrouter/auto",
    hint: "Key from openrouter.ai/keys. Routes to the best model for each request; hundreds of models, several free.",
  },
  {
    id: "zen",
    label: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    model: "kimi-k2.7-code",
    hint: "Key from opencode.ai/zen. Curated, benchmarked models — including free ones like deepseek-v4-flash-free and nemotron-3-ultra-free.",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    hint: "Key from platform.openai.com/api-keys.",
  },
  {
    id: "custom",
    label: "Custom endpoint",
    baseUrl: "",
    model: "",
    hint: "Any OpenAI-compatible server — a local model (LM Studio, Ollama), Together, Groq…",
  },
] as const;

export type AiProviderId = (typeof AI_PROVIDERS)[number]["id"];

export function providerIdFor(baseUrl: string): AiProviderId {
  const b = baseUrl.trim().toLowerCase();
  if (b.includes("openrouter")) return "openrouter";
  if (b.includes("opencode.ai")) return "zen";
  if (b.includes("openai.com")) return "openai";
  return "custom";
}

export async function getAiConfig(): Promise<AiConfig> {
  return getSetting<AiConfig>("ai", DEFAULT_AI_CONFIG);
}

export type AiTurn = { role: "system" | "user" | "assistant"; content: string };

/** One completion against the configured endpoint. Throws on failure. */
export async function chatCompletion(config: AiConfig, messages: AiTurn[]): Promise<string> {
  if (!config.apiKey.trim()) throw new Error("No API key configured");
  const base = config.baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("No API base URL configured");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: config.model || "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI request failed (${res.status})${text ? ` — ${text.slice(0, 180)}` : ""}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("The model returned an empty response");
  return content;
}

/* --------------------------- life context ----------------------------- */

export interface LifeContext {
  now: Date;
  profileName: string;
  weather: string | null;
  healthToday: string[];
  lastSleep: string | null;
  unread: number;
  downloads: number;
  focusMinutesToday: number;
  habitsDoneToday: string[];
  spentThisMonth: number;
  notes: number;
  diary: number;
  media: number;
  news: string[];
  github: string | null;
}

/** Assemble a compact snapshot of the user's on-device life for the model. */
export async function gatherContext(): Promise<LifeContext> {
  const [profile, weather, news, gh, health, emails, downloads, focus, habits, habitLogs, notes, diary, music, movies, books, transactions] =
    await Promise.all([
      getSetting<{ name: string }>("profile", { name: "" }),
      fetchWeather().catch(() => null),
      fetchNewsList().catch(() => [] as { title: string; source: string }[]),
      (async () => {
        const cfg = await getSetting<{ username: string; token: string }>("github", { username: "", token: "" });
        if (!cfg.username) return null;
        return fetchGithubStats(cfg.username, cfg.token).catch(() => null);
      })(),
      getAll<any>("health"),
      getAll<any>("emails"),
      getAll<any>("downloads"),
      getAll<any>("focus"),
      getAll<any>("habits"),
      getAll<any>("habitLogs"),
      getAll<any>("notes"),
      getAll<any>("diary"),
      getAll<any>("music"),
      getAll<any>("movies"),
      getAll<any>("books"),
      getAll<any>("transactions"),
    ]);

  const now = new Date();
  const today = todayKey(now);
  const healthToday = health.filter((h) => h.date === today);
  const sleeps = health
    .filter((h) => h.type === "sleep" && h.data?.hours)
    .sort((a, b) => (a.date > b.date ? -1 : 1));
  const lastSleep = sleeps[0] as { date: string; data: { hours: number } } | undefined;

  const monthKey = today.slice(0, 7);
  const spentThisMonth = (transactions as any[])
    .filter((t) => t.kind === "expense" && t.date?.startsWith(monthKey))
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);

  const habitMap = new Map((habits as any[]).map((h) => [h.id, h.name as string]));
  const habitsDoneToday = (habitLogs as any[])
    .filter((l) => l.date === today)
    .map((l) => habitMap.get(l.habitId))
    .filter((n): n is string => Boolean(n));

  const focusMinutesToday = (focus as any[])
    .filter((f) => f.date === today && f.kind === "focus")
    .reduce((s, f) => s + (Number(f.minutes) || 0), 0);

  return {
    now,
    profileName: profile.name,
    weather: weather ? `${Math.round(weather.temp)}° ${weather.desc} in ${weather.city}` : null,
    healthToday: [...new Set(healthToday.map((h) => h.type as string))],
    lastSleep: lastSleep ? `${lastSleep.data.hours.toFixed(1)}h (${lastSleep.date})` : null,
    unread: emails.filter((e) => !e.read).length,
    downloads: downloads.filter((d) => d.status === "downloading" || d.status === "queued").length,
    focusMinutesToday,
    habitsDoneToday,
    spentThisMonth,
    notes: notes.length,
    diary: diary.length,
    media: music.length + movies.length + books.length,
    news: (news as any[]).slice(0, 5).map((n) => n.title),
    github: gh ? `${gh.name}: ${gh.publicRepos} repos, ${gh.stars} stars` : null,
  };
}

/* ----------------------------- briefings ------------------------------ */

const SYSTEM_PROMPT = [
  "You are Lifeflow, the calm, personal operating system for one person's life.",
  "You speak briefly, warmly and precisely — like a thoughtful assistant who knows everything stored on this device.",
  "You never invent facts: only use the context you are given, and say when something is missing.",
  "No emojis, no fluff, no lists unless a list genuinely helps.",
  "Write one short paragraph (2–4 sentences) for briefings.",
].join(" ");

function describeContext(ctx: LifeContext): string {
  const lines: string[] = [];
  lines.push(`It is ${ctx.now.toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" })}.`);
  if (ctx.profileName) lines.push(`The person's name is ${ctx.profileName}.`);
  if (ctx.weather) lines.push(`Weather: ${ctx.weather}.`);
  if (ctx.lastSleep) lines.push(`Last logged sleep: ${ctx.lastSleep}.`);
  if (ctx.healthToday.length > 0) lines.push(`Health logged today: ${ctx.healthToday.join(", ")}.`);
  else lines.push("Nothing health-related logged today.");
  if (ctx.focusMinutesToday > 0) lines.push(`Focused ${ctx.focusMinutesToday} minutes today.`);
  if (ctx.habitsDoneToday.length > 0) lines.push(`Habits completed today: ${ctx.habitsDoneToday.join(", ")}.`);
  if (ctx.unread > 0) lines.push(`${ctx.unread} unread email(s).`);
  if (ctx.downloads > 0) lines.push(`${ctx.downloads} download(s) in progress.`);
  if (ctx.spentThisMonth > 0) lines.push(`Spent this month: $${ctx.spentThisMonth.toFixed(2)}.`);
  lines.push(`On device: ${ctx.notes} notes, ${ctx.diary} journal entries, ${ctx.media} media items.`);
  if (ctx.github) lines.push(`GitHub: ${ctx.github}.`);
  if (ctx.news.length > 0) lines.push(`Latest headlines: ${ctx.news.join(" | ")}.`);
  return lines.join("\n");
}

/** Deterministic, offline briefing — the same shape as the AI one. */
export function ruleBasedBriefing(ctx: LifeContext): string {
  const parts: string[] = [];
  if (ctx.lastSleep) parts.push(`you slept ${ctx.lastSleep}`);
  if (ctx.healthToday.length === 0) parts.push("nothing health-logged yet today — a meal, a walk, or some water is a good start");
  if (ctx.focusMinutesToday > 0) parts.push(`${ctx.focusMinutesToday} focused minutes so far`);
  if (ctx.habitsDoneToday.length > 0) parts.push(`${ctx.habitsDoneToday.length} habit${ctx.habitsDoneToday.length > 1 ? "s" : ""} ticked off`);
  if (ctx.unread > 0) parts.push(`${ctx.unread} unread email${ctx.unread > 1 ? "s" : ""}`);
  if (ctx.weather) parts.push(`${ctx.weather.split(" in ")[0]} outside`);
  if (ctx.downloads > 0) parts.push(`${ctx.downloads} download${ctx.downloads > 1 ? "s" : ""} in progress`);
  if (ctx.spentThisMonth > 0) parts.push(`$${ctx.spentThisMonth.toFixed(0)} spent this month`);
  if (parts.length === 0) parts.push("everything is quiet — take a moment for yourself");
  const greet = `${greeting(ctx.now)}, ${ctx.profileName || "friend"}.`;
  return `${greet} ${parts.slice(0, 3).join(". ")}.`;
}

/**
 * Build today's briefing — AI when configured and online, rules otherwise.
 * Results are cached on-device for 20 minutes so the dashboard doesn't burn
 * tokens on every visit; pass force=true to regenerate now.
 */
export async function generateBriefing(force = false): Promise<{ text: string; fromAi: boolean }> {
  const cached = await getSetting<{ text: string; fromAi: boolean; ts: number } | null>("briefingCache", null);
  if (!force && cached && Date.now() - cached.ts < 20 * 60_000) return cached;

  const config = await getAiConfig();
  const ctx = await gatherContext();
  let out: { text: string; fromAi: boolean };
  if (config.enabled && config.apiKey.trim() && navigator.onLine) {
    try {
      const user = [
        `Write a short, warm daily briefing for ${ctx.profileName || "the user"}.`,
        "Start with a one-line greeting that nods to the time of day.",
        "Then mention the 2–3 most useful things from the context.",
        "End with one quiet, specific suggestion if anything is clearly missing or overdue.",
        "",
        describeContext(ctx),
      ].join("\n");
      const text = await chatCompletion(config, [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ]);
      out = { text, fromAi: true };
    } catch {
      out = { text: ruleBasedBriefing(ctx), fromAi: false };
    }
  } else {
    out = { text: ruleBasedBriefing(ctx), fromAi: false };
  }
  await setSetting("briefingCache", { ...out, ts: Date.now() });
  return out;
}

/** Chat with full context attached — used by the Companion page. */
export async function companionReply(messages: AiMessage[], includeContext: boolean): Promise<string> {
  const config = await getAiConfig();
  const turns: AiTurn[] = [{ role: "system", content: SYSTEM_PROMPT }];
  if (includeContext) {
    const ctx = await gatherContext();
    turns.push({ role: "system", content: `Current on-device context:\n${describeContext(ctx)}` });
  }
  for (const m of messages.slice(-16)) {
    turns.push({ role: m.role, content: m.content });
  }
  return chatCompletion(config, turns);
}

/** Persisted conversation history (the aiChat store). */
export async function loadAiHistory(): Promise<AiMessage[]> {
  const d = await db();
  return (await d.getAll("aiChat")) as AiMessage[];
}
