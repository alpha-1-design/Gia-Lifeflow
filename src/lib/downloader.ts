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
 */

export const CHUNK_SIZE = 4 * 1024 * 1024;
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;

const controllers = new Map<string, AbortController>();
const progressTimers = new Map<string, ReturnType<typeof setTimeout>>();

interface ChunkRec {
  id: string;
  blob: Blob;
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

export async function startDownload(input: {
  url: string;
  kind: "music" | "movie" | "book";
  title: string;
}): Promise<void> {
  const task: DownloadTask = {
    id: uid(),
    url: input.url,
    kind: input.kind,
    title: input.title,
    total: 0,
    progress: 0,
    status: "queued",
    createdAt: Date.now(),
  };
  await put("downloads", task);
  void runDownload(task.id);
}

/** Throttled persistence of the live progress value. */
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
      await put("downloads", task);
    }, 250),
  );
}

async function runDownload(id: string): Promise<void> {
  const task = await getOne<DownloadTask>("downloads", id);
  if (!task) return;

  const controller = new AbortController();
  controllers.set(id, controller);

  try {
    task.status = "downloading";
    await put("downloads", task);

    // Probe server capabilities.
    let total = 0;
    let ranges = false;
    let mime = "";
    try {
      const head = await fetch(task.url, { method: "HEAD", signal: controller.signal });
      total = Number(head.headers.get("content-length")) || 0;
      ranges = head.headers.get("accept-ranges") === "bytes";
      mime = head.headers.get("content-type") || "";
    } catch {
      /* HEAD unsupported — detect ranges from the first GET below */
    }

    if (ranges && total > CHUNK_SIZE) {
      const chunkCount = Math.ceil(total / CHUNK_SIZE);
      task.total = total;
      await put("downloads", task);

      let completed = await storedChunkBytes(id);
      let cursor = 0;
      const results = new Array<Blob | null>(chunkCount).fill(null);

      const fetchChunk = async (idx: number) => {
        if (await chunkKeyExists(id, idx)) {
          const row = await getOne<ChunkRec>("chunks", `${id}:${idx}`);
          results[idx] = row?.blob ?? null;
          return;
        }
        const start = idx * CHUNK_SIZE;
        const end = Math.min(total - 1, start + CHUNK_SIZE - 1);
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            const res = await fetch(task.url, {
              signal: controller.signal,
              headers: { Range: `bytes=${start}-${end}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            const blob = new Blob([buf], { type: res.headers.get("content-type") || mime });
            await put("chunks", { id: `${id}:${idx}`, blob } satisfies ChunkRec);
            results[idx] = blob;
            completed += blob.size;
            scheduleProgressWrite(id, completed);
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
        return;
      }

      const parts: Blob[] = [];
      for (let i = 0; i < chunkCount; i++) {
        const b = results[i];
        if (!b) throw new Error(`Missing chunk ${i}`);
        parts.push(b);
      }
      const blob = new Blob(parts, { type: mime || "application/octet-stream" });
      const blobId = await saveBlob(blob, mime);
      await put("downloads", { ...task, total, progress: 1, status: "done", blobId });
      notify("Download complete", task.title);
    } else {
      // Single streaming download.
      const res = await fetch(task.url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get("content-type") || mime;
      const len = Number(res.headers.get("content-length")) || total || 0;
      task.total = len;
      await put("downloads", task);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const parts: BlobPart[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        received += value.byteLength;
        if (len) scheduleProgressWrite(id, received);
      }
      const blob = new Blob(parts, { type: ct });
      const blobId = await saveBlob(blob, ct);
      await put("downloads", { ...task, progress: 1, status: "done", blobId });
      notify("Download complete", task.title);
    }
  } catch (err) {
    if (controller.signal.aborted) {
      await put("downloads", { ...task, status: "canceled" });
      return;
    }
    console.error("Download failed:", err);
    await put("downloads", {
      ...task,
      status: "error",
      error: err instanceof Error ? err.message : "Download failed",
    });
  } finally {
    controllers.delete(id);
    const t = progressTimers.get(id);
    if (t) clearTimeout(t);
    progressTimers.delete(id);
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
  await remove("downloads", id);
}
