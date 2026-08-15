import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  History,
  Loader2,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import { clearStore, put, remove, useCollection, useSetting, type BrowserEntry, type BrowserHistoryEntry } from "@/lib/db";
import { relativeTime, uid } from "@/lib/format";

const ENGINES = {
  duckduckgo: { label: "DuckDuckGo", search: (q: string) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}` },
  google: { label: "Google", search: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  bing: { label: "Bing", search: (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  brave: { label: "Brave", search: (q: string) => `https://search.brave.com/search?q=${encodeURIComponent(q)}` },
  startpage: { label: "Startpage", search: (q: string) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}` },
} as const;
type EngineId = keyof typeof ENGINES;

function hostOf(url: string): string {
  if (!url || url === "about:blank") return "New tab";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Turns what the user typed into a destination:
 * - empty → about:blank
 * - `about:*` or a full scheme URL → used as-is
 * - a bare hostname (no spaces) → https://
 * - anything else → a search on the selected engine
 */
function normalize(raw: string, engine: EngineId): string {
  const t = raw.trim();
  if (!t) return "about:blank";
  if (/^about:/i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  const bareHost = /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/[^\s]*)?$/i;
  if (bareHost.test(t)) return `https://${t}`;
  return ENGINES[engine].search(t);
}

interface Tab {
  id: string;
  history: string[];
  index: number;
  key: number; // bumped to force the iframe to reload
}

const newTab = (): Tab => ({ id: uid(), history: ["about:blank"], index: 0, key: 0 });

export default function Browser() {
  const pinned = useCollection<BrowserEntry>("browser");
  const history = useCollection<BrowserHistoryEntry>("browserHistory");
  const [engine, setEngine] = useSetting<EngineId>("browserEngine", "duckduckgo");

  const [tabs, setTabs] = useState<Tab[]>(() => [newTab()]);
  const [activeId, setActiveId] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const src = active.history[active.index] ?? "about:blank";

  useEffect(() => setInput(src === "about:blank" ? "" : src), [src]);

  const recordHistory = (url: string) => {
    if (!url || url === "about:blank") return;
    void put<BrowserHistoryEntry>("browserHistory", { id: uid(), url, title: hostOf(url), visitedAt: Date.now() });
  };

  const updateTab = (id: string, patch: Partial<Tab>) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const go = (raw: string) => {
    const url = normalize(raw, engine);
    if (url === active.history[active.index]) return;
    const nextHistory = [...active.history.slice(0, active.index + 1), url];
    updateTab(active.id, { history: nextHistory, index: nextHistory.length - 1, key: active.key + 1 });
    setInput(url === "about:blank" ? "" : url);
    setLoading(true);
    recordHistory(url);
  };

  const back = () => {
    if (active.index <= 0) return;
    updateTab(active.id, { index: active.index - 1, key: active.key + 1 });
    setLoading(true);
  };

  const forward = () => {
    if (active.index >= active.history.length - 1) return;
    updateTab(active.id, { index: active.index + 1, key: active.key + 1 });
    setLoading(true);
  };

  const reload = () => {
    updateTab(active.id, { key: active.key + 1 });
    setLoading(true);
  };

  const addTab = () => {
    const t = newTab();
    setTabs((ts) => [...ts, t]);
    setActiveId(t.id);
    setInput("");
  };

  const closeTab = (id: string) => {
    const remaining = tabs.filter((t) => t.id !== id);
    const next = remaining.length === 0 ? [newTab()] : remaining;
    setTabs(next);
    if (id === active.id) {
      const idx = tabs.findIndex((t) => t.id === id);
      const fallback = next[Math.max(0, idx - 1)] ?? next[0];
      setActiveId(fallback.id);
    }
  };

  const isPinned = src !== "about:blank" && pinned.some((p) => p.url === src);

  const togglePin = async () => {
    if (src === "about:blank") return;
    const existing = pinned.find((p) => p.url === src);
    if (existing) {
      await remove("browser", existing.id);
      toast("Unpinned");
    } else {
      await put<BrowserEntry>("browser", { id: uid(), url: src, title: hostOf(src), pinned: true, visitedAt: Date.now() });
      toast("Pinned");
    }
  };

  const openExternal = () => {
    if (src === "about:blank") return;
    window.open(src, "_blank", "noopener");
  };

  const clearHistory = async () => {
    await clearStore("browserHistory");
    toast("History cleared");
  };

  const uniqueHistory = useMemo(() => {
    const seen = new Set<string>();
    return [...history]
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .filter((h) => {
        if (seen.has(h.url)) return false;
        seen.add(h.url);
        return true;
      })
      .slice(0, 12);
  }, [history]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        eyebrow="Tools"
        title="Browser"
        description="A quiet little multi-tab browser. Search, pin, and open externally anything that refuses to embed."
      />

      {/* Tab strip */}
      <div className="flex items-center gap-1 border-b px-2 pt-1.5 pb-1.5">
        {tabs.map((t) => {
          const tabUrl = t.history[t.index] ?? "about:blank";
          const isActive = t.id === active.id;
          return (
            <div
              key={t.id}
              className={`flex max-w-44 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
                isActive ? "border-foreground/50 bg-accent/50" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              <button type="button" onClick={() => setActiveId(t.id)} className="min-w-0 flex-1 truncate text-left">
                {hostOf(tabUrl)}
              </button>
              <button
                type="button"
                onClick={() => closeTab(t.id)}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                title="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={addTab}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="New tab"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1.5 border-b px-2 py-2 md:px-4">
        <button type="button" onClick={back} disabled={active.index <= 0} title="Back" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-accent disabled:opacity-40">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={forward} disabled={active.index >= active.history.length - 1} title="Forward" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-accent disabled:opacity-40">
          <ArrowRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={reload} title="Reload" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-accent">
          <RefreshCw className="h-4 w-4" />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3">
          {loading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" /> : <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go(input);
            }}
            placeholder="Search or enter address…"
            className="h-9 w-full bg-transparent text-sm outline-none"
          />
          {input && (
            <button type="button" onClick={() => setInput("")} className="shrink-0 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button type="button" onClick={() => go(input)} className="h-9 shrink-0 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90">
          Go
        </button>

        <select
          value={engine}
          onChange={(e) => setEngine(e.target.value as EngineId)}
          title="Search engine"
          className="hidden h-9 rounded-md border bg-transparent px-2 text-xs outline-none focus:border-foreground/40 sm:block"
        >
          {Object.entries(ENGINES).map(([id, e]) => (
            <option key={id} value={id}>
              {e.label}
            </option>
          ))}
        </select>

        <button type="button" onClick={() => void togglePin()} disabled={src === "about:blank"} title="Pin" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-accent disabled:opacity-40">
          {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </button>
        <button type="button" onClick={openExternal} disabled={src === "about:blank"} title="Open externally" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-accent disabled:opacity-40">
          <ExternalLink className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          title="History"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-accent ${showHistory ? "bg-accent text-foreground" : ""}`}
        >
          <History className="h-4 w-4" />
        </button>
      </div>

      {/* Pinned sites */}
      {pinned.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b px-3 py-2 md:px-4">
          {pinned.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => go(p.url)}
              title={p.url}
              className="flex max-w-56 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent"
            >
              <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{hostOf(p.url)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        {src === "about:blank" ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto p-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-md bg-foreground text-background">
              <Globe className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-medium">Search the web</p>
              <p className="mt-1 text-xs text-muted-foreground">Type above and hit Enter — or pick a pinned site or recent page below.</p>
            </div>

            {uniqueHistory.length > 0 && (
              <div className="w-full max-w-md">
                <p className="microlabel mb-2">Recent</p>
                <div className="space-y-1 text-left">
                  {uniqueHistory.slice(0, 8).map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => go(h.url)}
                      className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent"
                    >
                      <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{h.title || hostOf(h.url)}</span>
                        <span className="block truncate text-xs text-muted-foreground">{h.url}</span>
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{relativeTime(h.visitedAt)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <iframe
            key={active.key}
            src={src}
            title={hostOf(src)}
            onLoad={() => setLoading(false)}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            className="h-full w-full border-0 bg-white"
          />
        )}
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="border-t p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="microlabel">History</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void clearHistory()} disabled={history.length === 0} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-40">
                <Trash2 className="h-3 w-3" /> Clear
              </button>
              <button type="button" onClick={() => setShowHistory(false)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          {uniqueHistory.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No history yet.</p>
          ) : (
            <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
              {uniqueHistory.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => go(h.url)}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{h.title || hostOf(h.url)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{relativeTime(h.visitedAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
        Some sites (banking, video, social) refuse to render inside an app — use{" "}
        <button type="button" onClick={openExternal} className="underline">
          Open externally
        </button>{" "}
        for those.
      </p>
    </div>
  );
}
