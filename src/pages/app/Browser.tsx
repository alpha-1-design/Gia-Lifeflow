import { ArrowLeft, ArrowRight, ExternalLink, Globe, Pin, PinOff, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import { useCollection, put, remove, type BrowserEntry } from "@/lib/db";
import { relativeTime, uid } from "@/lib/format";

function normalize(raw: string): string {
  const t = raw.trim();
  if (!t) return "about:blank";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^about:/i.test(t)) return t;
  return `https://${t}`;
}

export default function Browser() {
  const pinned = useCollection<BrowserEntry>("browser");
  const [input, setInput] = useState("");
  const [src, setSrc] = useState("about:blank");
  const [history, setHistory] = useState<string[]>(["about:blank"]);
  const [index, setIndex] = useState(0);
  const [key, setKey] = useState(0);

  useEffect(() => setInput(src === "about:blank" ? "" : src), [src]);

  const go = (raw: string) => {
    const url = normalize(raw);
    if (url === src) return;
    const next = [...history.slice(0, index + 1), url];
    setHistory(next);
    setIndex(next.length - 1);
    setSrc(url);
    setKey((k) => k + 1);
  };

  const back = () => {
    if (index <= 0) return;
    const i = index - 1;
    setIndex(i);
    setSrc(history[i]);
    setKey((k) => k + 1);
  };

  const forward = () => {
    if (index >= history.length - 1) return;
    const i = index + 1;
    setIndex(i);
    setSrc(history[i]);
    setKey((k) => k + 1);
  };

  const reload = () => setKey((k) => k + 1);

  const isPinned = src !== "about:blank" && pinned.some((p) => p.url === src);

  const togglePin = async () => {
    if (src === "about:blank") return;
    const existing = pinned.find((p) => p.url === src);
    if (existing) {
      await remove("browser", existing.id);
      toast("Unpinned");
    } else {
      await put<BrowserEntry>("browser", { id: uid(), url: src, title: src, pinned: true, visitedAt: Date.now() });
      toast("Pinned");
    }
  };

  const openExternal = () => {
    if (src === "about:blank") return;
    window.open(src, "_blank", "noopener");
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        eyebrow="Tools"
        title="Browser"
        description="A quiet little browser. Sites that block embedding can be opened externally."
      />

      {/* Address bar */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={back} disabled={index <= 0} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-accent disabled:opacity-40">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={forward} disabled={index >= history.length - 1} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-accent disabled:opacity-40">
          <ArrowRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={reload} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-accent">
          <RefreshCw className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3">
          <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
        <button type="button" onClick={() => go(input)} className="h-9 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90">
          Go
        </button>
        <button type="button" onClick={() => void togglePin()} disabled={src === "about:blank"} title="Pin" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-accent disabled:opacity-40">
          {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </button>
        <button type="button" onClick={openExternal} disabled={src === "about:blank"} title="Open externally" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-accent disabled:opacity-40">
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>

      {/* Pinned */}
      {pinned.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {pinned.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => go(p.url)}
              title={p.url}
              className="flex max-w-56 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent"
            >
              <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{p.url.replace(/^https?:\/\//, "")}</span>
              <span className="text-[10px] text-muted-foreground/70">{relativeTime(p.visitedAt)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Frame */}
      <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-md border bg-card">
        {src === "about:blank" ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <Globe className="h-6 w-6 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              Type an address above. Pinned sites appear here for one-tap access.
            </p>
          </div>
        ) : (
          <iframe
            key={key}
            src={src}
            title="Lifeflow browser"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            className="h-full w-full border-0 bg-white"
          />
        )}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Some sites (banking, video, social) refuse to render inside an app — use{" "}
        <button type="button" onClick={openExternal} className="underline">
          Open externally
        </button>{" "}
        for those.
      </p>
    </div>
  );
}
