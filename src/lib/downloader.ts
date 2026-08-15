import { uid } from "./format";
import { getOne, put, remove, saveBlob, type DownloadTask } from "./db";
import { notify } from "./notifications";

/**
 * Accelerated downloader.
 *
 * Large files are split into 4 MB chunks that download in parallel (up to
 * CONCURRENCY at once) using HTTP Range requests — this genuinely saturates
 * the link better than a single stream. Chunks persist in IndexedDB, so an
 * interrupted download resumes from where it stopped instead of restarting.
 * Servers without Range support fall back to a single streaming download.
 *
 * A link can be accompanied by optional request headers (e.g. Authorization
 * for a private host) and, when the site blocks cross-origin fetches, an
 * optional public CORS relay fallback (the same `api.allorigins.win` relay the
 * news module uses). The relay is opt-in and only used after a direct attempt
 * fails, so direct links are never routed through a third party by default.
 */

export const CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const RELAY = "https://api.allorigins.win/raw?url=";

/**
 * Parallel connections per download, scaled to the device. More connections
 * saturate the link harder (the same trick download accelerators use); the
 * cap keeps us below typical per-host rate limits.
 */
const HARDWARE_CORES = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
const CONCURRENCY = Math.min(12, Math.max(6, Math.round(HARDWARE_CORES * 1.5)));

const controllers = new Map<string, AbortController>();
const progressTimers = new Map<string, ReturnType<typeof setTimeout>>();
const speedSamples = new Map<string, { bytes: number; ts: number }>();

interface ChunkRec {
  id: string;
  blob: Blob;
}

/** Pull a filename out of a Content-Disposition header (filename or filename*). */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return star[1];
    }
  }
  const plain = /filename=["']?([^"';]+)["']?/i.exec(header);
  if (plain) return plain[1].trim();
  return null;
}

/** The public CORS relay URL used when a direct fetch is blocked. */
export function relayUrl(url: string): string {
  return `${RELAY}${encodeURIComponent(url)}`;
}

async function chunkKeyExists(dlId: string, idx: number): Promise<boolean> {
  const row = await getOne<ChunkRec>("chunks", `${dlId}:${idx}`);
  return !!row;
}

async function storedChunkBytes(dlId: string): Promise<number> {
  const { db } = await import("./db");
  const d = await db();
  const all = (await d.getAll("chunks")) as ChunkRec[];
  return all
    .filter((c) => c.id.startsWith(`${dlId}:`))
    .reduce((sum, c) => sum + c.blob.size, 0);
}

export function isDownloadActive(id: string): boolean {
  return controllers.has(id);
}

export function cancelDownload(id: string): void {
  controllers.get(id)?.abort();
}

export interface DownloadInput {
  url: string;
  kind: "music" | "movie" | "book";
  title: string;
  headers?: Record<string, string>;
  useRelay?: boolean;
}

export async function startDownload(input: DownloadInput): Promise<void> {
  const task: DownloadTask = {
    id: uid(),
    url: input.url,
    kind: input.kind,
    title: input.title,
    total: 0,
    progress: 0,
    status: "queued",
    createdAt: Date.now(),
    headers: input.headers,
    useRelay: input.useRelay,
  };
  await put("downloads", task);
  void runDownload(task.id);
}

/** Throttled persistence of the live progress, received bytes and speed. */
function scheduleProgressWrite(id: string, completed: number) {
  const existing = progressTimers.get(id);
  if (existing) clearTimeout(existing);
  progressTimers.set(
    id,
    setTimeout(async () => {
      progressTimers.delete(id);
      const task = await getOne<DownloadTask>("downloads", id);
      if (!task || task.status !== "downloading") return;
      task.progress = task.total > 0 ? Math.min(1, completed / task.total) : task.progress;
      task.received = completed;
      const now = Date.now();
      const prev = speedSamples.get(id);
      if (prev) {
        const dt = (now - prev.ts) / 1000;
        if (dt > 0) task.speed = Math.max(0, (completed - prev.bytes) / dt);
      }
      speedSamples.set(id, { bytes: completed, ts: now });
      await put("downloads", task);
    }, 250),
  );
}

interface Outcome {
  blob: Blob;
  mime: string;
  finalName: string | null;
}

/** Read a response body as a single blob, updating progress as it streams. */
async function streamBody(res: Response, id: string, mime: string): Promise<Blob> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const len = Number(res.headers.get("content-length")) || 0;
  const parts: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.byteLength;
    if (len) scheduleProgressWrite(id, received);
  }
  return new Blob(parts, { type: mime });
}

/** Direct download: HEAD probe → chunked (Range) or single-stream fallback. */
async function downloadDirect(task: DownloadTask, controller: AbortController): Promise<Outcome> {
  const headers = task.headers ?? {};
  const hdrs = (extra?: Record<string, string>) => ({ ...headers, ...(extra ?? {}) });

  let total = 0;
  let ranges = false;
  let mime = "";
  let finalName: string | null = null;
  try {
    const head = await fetch(task.url, { method: "HEAD", headers: hdrs(), signal: controller.signal });
    total = Number(head.headers.get("content-length")) || 0;
    ranges = head.headers.get("accept-ranges") === "bytes";
    mime = head.headers.get("content-type") || "";
    finalName = filenameFromDisposition(head.headers.get("content-disposition"));
  } catch {
    /* HEAD unsupported — detect ranges from the first GET below */
  }

  if (ranges && total > CHUNK_SIZE) {
    const chunkCount = Math.ceil(total / CHUNK_SIZE);
    task.total = total;
    await put("downloads", task);

    let completed = await storedChunkBytes(task.id);
    let cursor = 0;
    const results = new Array<Blob | null>(chunkCount).fill(null);

    const fetchChunk = async (idx: number) => {
      if (await chunkKeyExists(task.id, idx)) {
        const row = await getOne<ChunkRec>("chunks", `${task.id}:${idx}`);
        results[idx] = row?.blob ?? null;
        return;
      }
      const start = idx * CHUNK_SIZE;
      const end = Math.min(total - 1, start + CHUNK_SIZE - 1);
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const res = await fetch(task.url, {
            signal: controller.signal,
            headers: hdrs({ Range: `bytes=${start}-${end}` }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          const blob = new Blob([buf], { type: res.headers.get("content-type") || mime });
          await put("chunks", { id: `${task.id}:${idx}`, blob } satisfies ChunkRec);
          results[idx] = blob;
          completed += blob.size;
          scheduleProgressWrite(task.id, completed);
          return;
        } catch (err) {
          if (controller.signal.aborted) return;
          if (attempt === MAX_ATTEMPTS) throw err;
          await new Promise((r) => setTimeout(r, 400 * attempt));
        }
      }
    };

    const pool = async () => {
      const workers: Promise<void>[] = [];
      for (let w = 0; w < CONCURRENCY; w++) {
        workers.push(
          (async () => {
            while (cursor < chunkCount && !controller.signal.aborted) {
              const idx = cursor++;
              await fetchChunk(idx);
            }
          })(),
        );
      }
      await Promise.all(workers);
    };
    await pool();

    if (controller.signal.aborted) {
      await put("downloads", { ...task, status: "canceled", progress: task.total ? completed / task.total : 0 });
      throw new AbortError();
    }

    const parts: Blob[] = [];
    for (let i = 0; i < chunkCount; i++) {
      const b = results[i];
      if (!b) throw new Error(`Missing chunk ${i}`);
      parts.push(b);
    }
    const blob = new Blob(parts, { type: mime || "application/octet-stream" });
    return { blob, mime, finalName };
  }

  // Single streaming download.
  const res = await fetch(task.url, { headers: hdrs(), signal: controller.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || mime;
  finalName = filenameFromDisposition(res.headers.get("content-disposition")) ?? finalName;
  const len = Number(res.headers.get("content-length")) || total || 0;
  task.total = len;
  await put("downloads", task);
  const blob = await streamBody(res, task.id, ct);
  return { blob, mime: ct, finalName };
}

/** Single-stream download through the public CORS relay. */
async function downloadViaRelay(task: DownloadTask, controller: AbortController): Promise<Outcome> {
  const res = await fetch(relayUrl(task.url), { signal: controller.signal });
  if (!res.ok) throw new Error(`Relay failed (HTTP ${res.status})`);
  const ct = res.headers.get("content-type") || "";
  const finalName = filenameFromDisposition(res.headers.get("content-disposition"));
  task.total = Number(res.headers.get("content-length")) || 0;
  await put("downloads", task);
  const blob = await streamBody(res, task.id, ct);
  return { blob, mime: ct, finalName };
}

/** Marker so an aborted download skips the generic error branch. */
class AbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

/** Turn a raw failure into a short, actionable message. */
function describeError(err: unknown): string {
  if (err instanceof AbortError) return "Canceled";
  if (err instanceof TypeError) {
    return "The site blocked the request (network/CORS). Enable the relay option or check the link.";
  }
  if (err instanceof Error) {
    const m = err.message;
    if (m.startsWith("HTTP 403")) return "The site refused the request (403). Some hosts block downloads — try the relay option.";
    if (m.startsWith("HTTP 404")) return "File not found (404) — check the link.";
    if (m.startsWith("HTTP 401")) return "Authentication required (401). Add an Authorization header.";
    if (m.startsWith("HTTP 429")) return "Too many requests (429) — try again in a moment.";
    return m;
  }
  return "Download failed";
}

async function runDownload(id: string): Promise<void> {
  const task = await getOne<DownloadTask>("downloads", id);
  if (!task) return;

  const controller = new AbortController();
  controllers.set(id, controller);

  try {
    task.status = "downloading";
    await put("downloads", task);

    let outcome: Outcome;
    try {
      outcome = await downloadDirect(task, controller);
    } catch (err) {
      if (controller.signal.aborted) throw new AbortError();
      if (task.useRelay) {
        outcome = await downloadViaRelay(task, controller);
      } else {
        throw err;
      }
    }

    if (controller.signal.aborted) throw new AbortError();

    const blobId = await saveBlob(outcome.blob, outcome.mime);
    await put("downloads", {
      ...task,
      total: outcome.blob.size,
      progress: 1,
      status: "done",
      blobId,
      finalName: outcome.finalName ?? task.finalName,
    });
    notify("Download complete", outcome.finalName || task.title);
  } catch (err) {
    if (controller.signal.aborted || err instanceof AbortError) {
      await put("downloads", { ...task, status: "canceled" });
      return;
    }
    console.error("Download failed:", err);
    await put("downloads", { ...task, status: "error", error: describeError(err) });
  } finally {
    controllers.delete(id);
    const t = progressTimers.get(id);
    if (t) clearTimeout(t);
    progressTimers.delete(id);
    speedSamples.delete(id);
  }
}

export async function deleteDownload(id: string): Promise<void> {
  const task = await getOne<DownloadTask>("downloads", id);
  if (task?.blobId) {
    const { deleteBlob } = await import("./db");
    await deleteBlob(task.blobId);
  }
  const { db } = await import("./db");
  const d = await db();
  const all = (await d.getAll("chunks")) as ChunkRec[];
  const tx = d.transaction("chunks", "readwrite");
  for (const c of all) {
    if (c.id.startsWith(`${id}:`)) tx.store.delete(c.id);
  }
  await tx.done;
  speedSamples.delete(id);
  await remove("downloads", id);
}
