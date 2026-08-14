import { Bot, Send, Sparkles, Trash2, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import { useCollection, put, remove, type AiMessage } from "@/lib/db";
import { companionReply, getAiConfig } from "@/lib/ai";
import { fmtTime } from "@/lib/format";

const SUGGESTIONS = [
  "What should I focus on today?",
  "Summarize my week",
  "Plan tomorrow for me",
  "Which habit am I slipping on?",
  "Tell me something useful from my data",
];

export default function Companion() {
  const history = useCollection<AiMessage>("aiChat");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [withContext, setWithContext] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void getAiConfig().then((c) => setConfigured(c.enabled && !!c.apiKey.trim()));
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history.length, busy]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const userMsg: AiMessage = { id: crypto.randomUUID(), role: "user", content, ts: Date.now() };
    await put("aiChat", userMsg);
    setInput("");
    setBusy(true);
    try {
      const reply = await companionReply([...history, userMsg], withContext);
      await put<AiMessage>("aiChat", {
        id: crypto.randomUUID(),
        role: "assistant",
        content: reply,
        ts: Date.now(),
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not reach the AI endpoint");
    } finally {
      setBusy(false);
    }
  };

  const clearHistory = async () => {
    for (const m of history) await remove("aiChat", m.id);
    toast("Conversation cleared");
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        eyebrow="Companion"
        title="Companion"
        description="An assistant that knows what's on this device — nothing leaves unless you ask."
        actions={
          <button
            type="button"
            onClick={() => void clearHistory()}
            disabled={history.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        }
      />

      {!configured && (
        <div className="mb-4 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          No AI key configured yet — open{" "}
          <a href="/app/settings" className="underline decoration-border underline-offset-2 hover:text-foreground">
            Settings → AI companion
          </a>{" "}
          to connect a model (OpenAI, Groq, OpenRouter — any OpenAI-compatible endpoint).
        </div>
      )}
      {offline && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <WifiOff className="h-3.5 w-3.5" /> Offline — the companion needs its model endpoint. Everything else keeps
          working.
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col rounded-md border bg-card">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {history.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-md bg-foreground text-background">
                <Bot className="h-6 w-6" />
              </span>
              <div>
                <p className="text-sm font-medium">Talk to your life.</p>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                  Ask about your day, your habits, your spending, your sleep — or just think out loud. With context
                  on, it reads what's on this device first.
                </p>
              </div>
              <div className="flex max-w-md flex-wrap justify-center gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {history.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-md px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-foreground text-background"
                    : "border bg-background text-foreground/90"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
                <p className={`mt-1.5 text-[10px] ${m.role === "user" ? "text-background/60" : "text-muted-foreground"}`}>
                  {fmtTime(new Date(m.ts))}
                </p>
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-md border bg-background px-3.5 py-2.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground [animation-delay:300ms]" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t p-3">
          <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={withContext}
              onChange={(e) => setWithContext(e.target.checked)}
              className="accent-foreground"
            />
            <Sparkles className="h-3 w-3" /> Include my on-device context (notes, health, habits, mail, spending…)
          </label>
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder={offline ? "Offline — type anyway and I'll queue the thought" : "Ask anything…"}
              className="min-h-[2.5rem] flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="inline-flex h-10 items-center gap-1.5 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Send className="h-4 w-4" /> Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
