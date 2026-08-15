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
  temperature?: number;
  maxTokens?: number;
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

export interface ModelEntry {
  id: string;
  label: string;
  vision?: boolean;
}

/** Curated model lists so you can switch models with a tap (no network needed). */
export const MODEL_CATALOG: Record<AiProviderId, ModelEntry[]> = {
  openrouter: [
    { id: "openrouter/auto", label: "Auto — best per request" },
    { id: "openai/gpt-4o", label: "GPT-4o", vision: true },
    { id: "openai/gpt-4o-mini", label: "GPT-4o mini", vision: true },
    { id: "openai/gpt-4.1", label: "GPT-4.1", vision: true },
    { id: "openai/o3-mini", label: "o3-mini" },
    { id: "anthropic/claude-3.7-sonnet", label: "Claude 3.7 Sonnet", vision: true },
    { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", vision: true },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", vision: true },
    { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash", vision: true },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
    { id: "deepseek/deepseek-chat-v3-0324", label: "DeepSeek V3" },
    { id: "qwen/qwen2.5-72b-instruct", label: "Qwen 2.5 72B" },
  ],
  zen: [
    { id: "kimi-k2.7-code", label: "Kimi K2.7 Code" },
    { id: "deepseek-v4-flash-free", label: "DeepSeek V4 Flash (free)" },
    { id: "nemotron-3-ultra-free", label: "Nemotron 3 Ultra (free)" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o", vision: true },
    { id: "gpt-4o-mini", label: "GPT-4o mini", vision: true },
    { id: "gpt-4.1", label: "GPT-4.1", vision: true },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", vision: true },
    { id: "o3-mini", label: "o3-mini" },
    { id: "o4-mini", label: "o4-mini", vision: true },
  ],
  custom: [],
};

/** Human label for the currently configured model (falls back to the raw id). */
export function modelLabel(config: AiConfig): string {
  const entry = (MODEL_CATALOG[providerIdFor(config.baseUrl)] ?? []).find((m) => m.id === config.model);
  return entry?.label ?? (config.model || "Custom model");
}

export async function getAiConfig(): Promise<AiConfig> {
  return getSetting<AiConfig>("ai", DEFAULT_AI_CONFIG);
}

export type AiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** A turn's content: plain text, or OpenAI-style multimodal content parts. */
export type AiContent = string | AiContentPart[];

export type AiTurn = { role: "system" | "user" | "assistant"; content: AiContent };

export interface ChatOptions {
  /** Stream tokens as they arrive instead of waiting for the whole reply. */
  onDelta?: (delta: string) => void;
  /** Override the request timeout (ms). */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function aiHeaders(config: AiConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey.trim()}`,
  };
}

function aiBody(config: AiConfig, messages: AiTurn[], stream: boolean) {
  return {
    model: config.model || "gpt-4o-mini",
    messages,
    temperature: config.temperature ?? 0.7,
    max_tokens: config.maxTokens ?? 700,
    ...(stream ? { stream: true } : {}),
  };
}

function describeAiError(status: number, text: string): string {
  const t = text.slice(0, 180);
  if (status === 401) return "Invalid API key (401) — check Settings → AI companion.";
  if (status === 402 || status === 429) return "Rate limit or quota reached (429/402) — try again shortly or switch model.";
  if (status === 404) return "Model not found (404) — check the model name.";
  if (status >= 500) return `Provider error (${status}) — try again in a moment.`;
  return `AI request failed (${status})${t ? ` — ${t}` : ""}`;
}

/** Retries transient network/5xx/429 failures a few times before giving up. */
async function completionNonStream(config: AiConfig, messages: AiTurn[], timeoutMs?: number): Promise<string> {
  const base = config.baseUrl.trim().replace(/\/+$/, "");
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: aiHeaders(config),
        body: JSON.stringify(aiBody(config, messages, false)),
        signal: AbortSignal.timeout(timeoutMs ?? 60_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(describeAiError(res.status, text));
        if (res.status === 429 || res.status >= 500) {
          lastErr = err;
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw err;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("The model returned an empty response");
      return content;
    } catch (err) {
      const transient = err instanceof TypeError || (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"));
      if (attempt < 2 && transient) {
        lastErr = err instanceof Error ? err : new Error("Network error");
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("AI request failed");
}

/** Extracts the text delta from a single SSE `data:` payload. */
function parseSseDelta(payload: string): string {
  try {
    const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
    return json.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}

/** Streams an OpenAI-compatible SSE response, calling onDelta per token. */
async function completionStream(config: AiConfig, messages: AiTurn[], onDelta: (d: string) => void, timeoutMs?: number): Promise<string> {
  const base = config.baseUrl.trim().replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: aiHeaders(config),
    body: JSON.stringify(aiBody(config, messages, true)),
    signal: AbortSignal.timeout(timeoutMs ?? 120_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(describeAiError(res.status, text));
  }
  if (!res.body) throw new Error("This endpoint doesn't support streaming");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  const emit = (payload: string) => {
    if (payload === "[DONE]") return;
    const delta = parseSseDelta(payload);
    if (delta) {
      full += delta;
      onDelta(delta);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      emit(trimmed.slice(5).trim());
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith("data:")) emit(tail.slice(5).trim());
  return full.trim();
}

/**
 * One completion against the configured endpoint. Pass `onDelta` to stream
 * tokens as they arrive; otherwise the full reply is awaited (with retries).
 */
export async function chatCompletion(config: AiConfig, messages: AiTurn[], opts: ChatOptions = {}): Promise<string> {
  if (!config.apiKey.trim()) throw new Error("No API key configured");
  const base = config.baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("No API base URL configured");
  if (opts.onDelta) return completionStream(config, messages, opts.onDelta, opts.timeoutMs);
  return completionNonStream(config, messages, opts.timeoutMs);
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

/** Options for the Companion's reply — extends ChatOptions with web search. */
export interface CompanionOptions extends ChatOptions {
  /** Pre-formatted live web-search results (from Exa) to ground the answer. */
  webContext?: string;
}

/** Turn a stored message into OpenAI-style content, including any attachments. */
function messageContent(m: AiMessage): AiContent {
  const atts = m.attachments ?? [];
  if (atts.length === 0) return m.content;
  const parts: AiContentPart[] = [];
  if (m.content.trim()) parts.push({ type: "text", text: m.content });
  for (const a of atts) {
    if (a.kind === "image" && a.dataUrl) {
      parts.push({ type: "image_url", image_url: { url: a.dataUrl } });
    } else if (a.kind === "text" && a.text) {
      parts.push({ type: "text", text: `\n[Attached file: ${a.name}]\n\`\`\`\n${a.text}\n\`\`\`` });
    }
  }
  if (parts.length === 0) return m.content || "";
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts;
}

/** Chat with full context attached — used by the Companion page. */
export async function companionReply(messages: AiMessage[], includeContext: boolean, opts?: CompanionOptions): Promise<string> {
  const config = await getAiConfig();
  const turns: AiTurn[] = [{ role: "system", content: SYSTEM_PROMPT }];
  if (includeContext) {
    const ctx = await gatherContext();
    turns.push({ role: "system", content: `Current on-device context:\n${describeContext(ctx)}` });
  }
  if (opts?.webContext) {
    turns.push({
      role: "system",
      content: [
        "Live web-search results (from Exa). Use them to answer factually and cite sources where it helps.",
        "If they don't answer the question, say so rather than guessing.",
        opts.webContext,
      ].join("\n"),
    });
  }
  for (const m of messages.slice(-16)) {
    turns.push({ role: m.role, content: messageContent(m) });
  }
  return chatCompletion(config, turns, opts);
}

/** Persisted conversation history (the aiChat store). */
export async function loadAiHistory(): Promise<AiMessage[]> {
  const d = await db();
  return (await d.getAll("aiChat")) as AiMessage[];
}
