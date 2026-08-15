import { Bot, ChevronDown, ExternalLink, Globe, Paperclip, Send, Sparkles, Trash2, WifiOff, X } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import Markdown from "@/components/app/Markdown";
import ModelPicker from "@/components/app/ModelPicker";
import PageHeader from "@/components/app/PageHeader";
import { useCollection, useSetting, put, remove, type AiAttachment, type AiMessage } from "@/lib/db";
import { DEFAULT_AI_CONFIG, companionReply, modelLabel, type AiConfig } from "@/lib/ai";
import { exaResultsToContext, searchWeb } from "@/lib/exa";
import { fmtTime } from "@/lib/format";

const SUGGESTIONS = [
  "What should I focus on today?",
  "Summarize my week",
  "Plan tomorrow for me",
  "Which habit am I slipping on?",
  "Tell me something useful from my data",
];

const fileExt = (name: string) => name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "FILE";

/** Turn inline [1]/[2] citation markers into clickable markdown links. */
function linkifyCitations(md: string, sources: { title: string; url: string }[]): string {
  return md.replace(/\[(\d+)\]/g, (match, n: string) => {
    const s = sources[Number(n) - 1];
    return s ? `[${n}](${s.url})` : match;
  });
}

/** Read an image and downscale it so the data URL stays small enough to send. */
async function downscaleImage(file: File, maxDim = 1280, quality = 0.85): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("Could not read the image"));
    fr.readAsDataURL(file);
  });
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not load the image"));
      img.src = dataUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    if (scale >= 1 && file.size < 300_000) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl;
  }
}

export default function Companion() {
  const history = useCollection<AiMessage>("aiChat");
  const [aiConfig, setAiConfig] = useSetting<AiConfig>("ai", DEFAULT_AI_CONFIG);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [withContext, setWithContext] = useState(true);
  const [webSearch, setWebSearch] = useState(false);
  const [attachments, setAttachments] = useState<AiAttachment[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const configured = aiConfig.enabled && !!aiConfig.apiKey.trim();

  useEffect(() => {
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
  }, [history.length, busy, attachments.length]);

  const onPickFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: AiAttachment[] = [];
    for (const f of Array.from(files)) {
      if (f.type.startsWith("image/")) {
        next.push({ name: f.name, mime: f.type, kind: "image", dataUrl: await downscaleImage(f) });
      } else {
        const text = await f.text().catch(() => "");
        if (text) next.push({ name: f.name, mime: f.type || "text/plain", kind: "text", text: text.slice(0, 120_000) });
      }
    }
    if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
  };

  const removeAttachment = (idx: number) => setAttachments((prev) => prev.filter((_, i) => i !== idx));

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if ((!content && attachments.length === 0) || busy) return;
    const userMsg: AiMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      ts: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    await put("aiChat", userMsg);
    setInput("");
    setAttachments([]);
    setBusy(true);

    // Optionally ground the answer with live web results before the reply.
    let webContext: string | undefined;
    let sources: { title: string; url: string }[] = [];
    if (webSearch) {
      try {
        const results = await searchWeb(content);
        webContext = exaResultsToContext(results);
        sources = results.map((r) => ({ title: r.title, url: r.url }));
      } catch (e) {
        toast(e instanceof Error ? e.message : "Web search failed");
      }
    }

    // Stream the reply into a live assistant message; fall back to a single
    // completion if the endpoint doesn't support streaming.
    const assistantId = crypto.randomUUID();
    const assistantMsg: AiMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      ts: Date.now(),
      sources: sources.length > 0 ? sources : undefined,
    };
    await put("aiChat", assistantMsg);

    let acc = "";
    let error: string | null = null;
    try {
      await companionReply([...history, userMsg], withContext, {
        webContext,
        onDelta: (d) => {
          acc += d;
          void put("aiChat", { ...assistantMsg, content: acc });
        },
      });
    } catch (e) {
      if (!acc) {
        try {
          acc = await companionReply([...history, userMsg], withContext, { webContext });
        } catch (e2) {
          error = e2 instanceof Error ? e2.message : "Could not reach the AI endpoint";
        }
      } else {
        error = e instanceof Error ? e.message : "Streaming interrupted";
      }
    }

    if (acc) {
      await put("aiChat", { ...assistantMsg, content: acc });
    } else {
      await remove("aiChat", assistantId);
    }
    if (error) toast(error);
    setBusy(false);
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              <Bot className="h-3.5 w-3.5" /> {modelLabel(aiConfig)} <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
            <button
              type="button"
              onClick={() => void clearHistory()}
              disabled={history.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </button>
          </div>
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
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground text-background shadow-lg ring-4 ring-accent/40">
                <Bot className="h-7 w-7" />
              </span>
              <div>
                <p className="text-sm font-medium">Talk to your life.</p>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                  Ask about your day, your habits, your spending, your sleep — or attach a photo or file and have it
                  broken down. Tap the model name up top to switch providers.
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

          {history.map((m) =>
            m.role === "user" ? (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex justify-end"
              >
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-4 py-3 text-sm leading-relaxed text-background shadow-sm">
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {m.attachments.map((a, i) =>
                        a.kind === "image" && a.dataUrl ? (
                          <img key={i} src={a.dataUrl} alt={a.name} className="max-h-40 rounded-lg border border-current/10" />
                        ) : (
                          <span key={i} className="rounded-md border border-current/20 px-2 py-1 text-[11px]">
                            {a.name}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                  {m.content && <p className="whitespace-pre-wrap">{m.content}</p>}
                  <p className="mt-1.5 text-[10px] text-background/60">{fmtTime(new Date(m.ts))}</p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex items-start gap-2.5"
              >
                <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background shadow-sm">
                  <Bot className="h-3.5 w-3.5" />
                </span>
                <div className="max-w-[85%] rounded-2xl rounded-tl-md border bg-background px-4 py-3 text-sm leading-relaxed text-foreground/90 shadow-sm">
                  {m.content && (
                    <Markdown>{m.sources?.length ? linkifyCitations(m.content, m.sources) : m.content}</Markdown>
                  )}
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-3 border-t pt-2">
                      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Sources</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {m.sources.map((s, i) => (
                          <a
                            key={i}
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground"
                          >
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[9px] font-semibold">
                              {i + 1}
                            </span>
                            <span className="truncate">{s.title}</span>
                            <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="mt-1.5 text-[10px] text-muted-foreground">{fmtTime(new Date(m.ts))}</p>
                </div>
              </motion.div>
            ),
          )}

          {busy && (
            <div className="flex items-start gap-2.5">
              <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background shadow-sm">
                <Bot className="h-3.5 w-3.5" />
              </span>
              <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border bg-background px-4 py-3 shadow-sm">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/70" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/70 [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/70 [animation-delay:240ms]" />
                <span className="ml-1 text-[11px] text-muted-foreground">Thinking…</span>
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
          <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
              className="accent-foreground"
            />
            <Globe className="h-3 w-3" /> Search the live web (Exa) to ground my answer
          </label>

          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <div key={i} className="relative flex items-center gap-2 rounded-md border p-1.5 pr-8">
                  {a.kind === "image" && a.dataUrl ? (
                    <img src={a.dataUrl} alt={a.name} className="h-10 w-10 rounded object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded bg-accent text-[9px] font-semibold text-muted-foreground">
                      {fileExt(a.name)}
                    </span>
                  )}
                  <span className="max-w-[10rem] truncate text-xs text-muted-foreground">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Attach a photo or file"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,.txt,.md,.json,.csv,.log,.ts,.js,.html,.xml"
              className="hidden"
              onChange={(e) => {
                void onPickFiles(e.target.files);
                e.target.value = "";
              }}
            />
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
              placeholder={offline ? "Offline — type anyway and I'll queue the thought" : "Ask anything, or attach a photo…"}
              className="min-h-[2.5rem] flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || (!input.trim() && attachments.length === 0)}
              className="inline-flex h-10 items-center gap-1.5 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Send className="h-4 w-4" /> Send
            </button>
          </div>
        </div>
      </div>

      {pickerOpen && (
        <ModelPicker
          config={aiConfig}
          onClose={() => setPickerOpen(false)}
          onSave={(c) => {
            setAiConfig(c);
            toast(`Model: ${modelLabel(c)}`);
          }}
        />
      )}
    </div>
  );
}
