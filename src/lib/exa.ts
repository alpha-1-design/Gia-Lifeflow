/**
 * Exa web search.
 *
 * A thin, dependency-free client for Exa's search endpoint. The key is stored
 * on-device (Settings → AI companion) and sent only to api.exa.ai. Results are
 * used to give the Companion live, sourced answers when "Search the web" is on.
 *
 * Docs: https://exa.ai/docs/reference/search
 */
import { getSetting } from "./db";

export interface ExaConfig {
  apiKey: string;
}

export const DEFAULT_EXA_CONFIG: ExaConfig = { apiKey: "" };

export function getExaConfig(): Promise<ExaConfig> {
  return getSetting<ExaConfig>("exa", DEFAULT_EXA_CONFIG);
}

export interface ExaResult {
  title: string;
  url: string;
  text: string;
  publishedDate?: string;
  author?: string;
}

export interface SearchOptions {
  /** Number of results to return (1–10, default 5). */
  numResults?: number;
  /** Max characters of page text per result (default 900). */
  maxChars?: number;
  /** Focus on a data category, e.g. "news" or "publication". */
  category?: "company" | "publication" | "news" | "personal site" | "financial report" | "people";
}

const EXA_ENDPOINT = "https://api.exa.ai/search";

function describeExaError(status: number, text: string): string {
  const t = text.slice(0, 200);
  if (status === 401) return "Invalid Exa API key (401) — check Settings → AI companion.";
  if (status === 402) return "Exa quota exhausted (402) — add credits at dashboard.exa.ai.";
  if (status === 429) return "Exa rate limit (429) — try again in a moment.";
  if (status >= 500) return `Exa is having trouble (${status}) — try again shortly.`;
  return `Exa search failed (${status})${t ? ` — ${t}` : ""}`;
}

/** Run a web search through Exa and return cleaned results. */
export async function searchWeb(query: string, opts: SearchOptions = {}): Promise<ExaResult[]> {
  const config = await getExaConfig();
  const key = config.apiKey.trim();
  if (!key) throw new Error("No Exa API key configured — add one in Settings → AI companion.");

  const numResults = Math.min(Math.max(opts.numResults ?? 5, 1), 10);
  const res = await fetch(EXA_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
    },
    body: JSON.stringify({
      query: query.trim(),
      numResults,
      type: "auto",
      ...(opts.category ? { category: opts.category } : {}),
      contents: { text: { maxCharacters: opts.maxChars ?? 900 } },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(describeExaError(res.status, text));
  }

  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  const results = (data.results ?? []).map((r) => ({
    title: String(r.title ?? "").trim(),
    url: String(r.url ?? "").trim(),
    text: typeof r.text === "string" ? r.text.trim() : "",
    publishedDate: typeof r.publishedDate === "string" ? r.publishedDate : undefined,
    author: typeof r.author === "string" ? r.author : undefined,
  }));
  return results.filter((r) => r.url);
}

/** Format search results into a compact, citation-ready block for the model. */
export function exaResultsToContext(results: ExaResult[]): string {
  if (results.length === 0) return "No web results.";
  return results
    .map((r, i) => {
      const date = r.publishedDate ? ` (${r.publishedDate.slice(0, 10)})` : "";
      const author = r.author ? ` by ${r.author}` : "";
      const text = r.text.length > 500 ? `${r.text.slice(0, 500)}…` : r.text;
      return `[${i + 1}] ${r.title}${author}${date}\n${r.url}\n${text || "(no excerpt)"}`;
    })
    .join("\n\n");
}
