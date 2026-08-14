import { Clapperboard, Download, Film, Pause, Play, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import { useCollection, put, remove, deleteBlob, saveBlob, blobUrl, type Movie, type DownloadTask } from "@/lib/db";
import { fmtBytes, fmtDuration, filenameFromUrl, relativeTime, uid } from "@/lib/format";
import { cancelDownload, deleteDownload, isDownloadActive, startDownload } from "@/lib/downloader";

export default function Movies() {
  const movies = useCollection<Movie>("movies");
  const downloads = useCollection<DownloadTask>("downloads");
  const [tab, setTab] = useState<"library" | "downloads">("library");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const lastSave = useRef(0);

  const sorted = [...movies].sort((a, b) => b.createdAt - a.createdAt);
  const movieDownloads = downloads.filter((d) => d.kind === "movie").sort((a, b) => b.createdAt - a.createdAt);
  const current = movies.find((m) => m.id === currentId) ?? null;

  // Finished downloads → library.
  useEffect(() => {
    movieDownloads.forEach((task) => {
      if (task.status === "done" && task.blobId && !movies.some((m) => m.blobId === task.blobId)) {
        void (async () => {
          const video = document.createElement("video");
          const u = await blobUrl(task.blobId!);
          if (u) {
            video.preload = "metadata";
            video.src = u;
            const duration = await new Promise<number>((resolve) => {
              video.onloadedmetadata = () => resolve(video.duration || 0);
              video.onerror = () => resolve(0);
            });
            URL.revokeObjectURL(u);
            await put<Movie>("movies", {
              id: uid(),
              title: task.title,
              blobId: task.blobId!,
              duration,
              createdAt: Date.now(),
              source: "url",
              progress: 0,
            });
          }
        })();
      }
    });
  }, [movieDownloads, movies]);

  const play = async (m: Movie) => {
    if (currentId === m.id) {
      if (videoRef.current) {
        if (playing) videoRef.current.pause();
        else void videoRef.current.play();
      }
      return;
    }
    videoRef.current?.pause();
    const u = await blobUrl(m.blobId);
    if (!u) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = u;
    const video = document.createElement("video");
    videoRef.current = video;
    video.src = u;
    video.controls = true;
    video.currentTime = m.progress || 0;
    video.ontimeupdate = () => {
      const now = Date.now();
      if (now - lastSave.current > 5000) {
        lastSave.current = now;
        void put<Movie>("movies", { ...m, progress: video.currentTime });
      }
    };
    video.onpause = () => {
      setPlaying(false);
      void put<Movie>("movies", { ...m, progress: video.currentTime });
    };
    video.onplay = () => setPlaying(true);
    video.onended = () => {
      setPlaying(false);
      void put<Movie>("movies", { ...m, progress: 0 });
    };
    setCurrentId(m.id);
  };

  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    let added = 0;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("video/")) continue;
      const blobId = await saveBlob(f, f.type);
      const video = document.createElement("video");
      video.preload = "metadata";
      const u = await blobUrl(blobId);
      if (!u) continue;
      video.src = u;
      const duration = await new Promise<number>((resolve) => {
        video.onloadedmetadata = () => resolve(video.duration || 0);
        video.onerror = () => resolve(0);
      });
      URL.revokeObjectURL(u);
      await put<Movie>("movies", {
        id: uid(),
        title: f.name.replace(/\.[a-z0-9]+$/i, ""),
        blobId,
        duration,
        createdAt: Date.now(),
        source: "device",
        progress: 0,
      });
      added++;
    }
    if (added > 0) toast(`${added} film${added > 1 ? "s" : ""} imported`);
  };

  const removeMovie = async (m: Movie) => {
    if (currentId === m.id) {
      videoRef.current?.pause();
      setCurrentId(null);
      setPlaying(false);
    }
    await deleteBlob(m.blobId);
    await remove("movies", m.id);
    toast("Film removed");
  };

  const resumeLabel = (m: Movie) => (m.progress > 5 ? `${Math.round((m.progress / Math.max(m.duration, 1)) * 100)}% watched` : "Not started");

  return (
    <div>
      <PageHeader
        eyebrow="Media"
        title="Movies"
        description="Watch on this device — imports, downloads, and resume where you left off."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab("library")}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${tab === "library" ? "bg-foreground text-background" : "hover:bg-accent"}`}
            >
              Library
            </button>
            <button
              type="button"
              onClick={() => setTab("downloads")}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${tab === "downloads" ? "bg-foreground text-background" : "hover:bg-accent"}`}
            >
              Downloads
            </button>
          </div>
        }
      />

      {tab === "library" && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <p className="microlabel">{sorted.length} films</p>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
              <Upload className="h-3.5 w-3.5" /> Import from device
              <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => { void importFiles(e.target.files); e.target.value = ""; }} />
            </label>
          </div>

          {sorted.length === 0 ? (
            <div className="quiet-card flex flex-col items-center p-12 text-center">
              <Clapperboard className="h-6 w-6 text-muted-foreground/50" />
              <p className="mt-3 text-sm text-muted-foreground">
                No films yet. Import files, or paste a direct video URL in Downloads.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {sorted.map((m) => (
                <div
                  key={m.id}
                  className={`group flex items-center gap-3 rounded-md border p-3 transition-colors ${
                    currentId === m.id ? "border-foreground/50 bg-accent/40" : "hover:bg-accent/30"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void play(m)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-foreground text-background transition-opacity hover:opacity-90"
                  >
                    {currentId === m.id && playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {fmtDuration(m.duration)} · {resumeLabel(m)}
                    </p>
                  </div>
                  <span className="hidden text-[11px] text-muted-foreground/70 sm:block">
                    {m.source === "device" ? "device" : "download"} · {relativeTime(m.createdAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeMovie(m)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {current && (
            <div className="mt-6 overflow-hidden rounded-md border bg-card">
              <video ref={videoRef} className="max-h-[70vh] w-full" controls autoPlay />
            </div>
          )}
        </>
      )}

      {tab === "downloads" && (
        <div>
          <div className="quiet-card p-5">
            <p className="microlabel">Accelerated download</p>
            <p className="mt-1 mb-4 text-xs text-muted-foreground">
              Parallel chunked downloads with resume — faster than a single stream.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/film.mp4"
                className="min-w-0 flex-1 rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                className="w-44 rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
              <button
                type="button"
                disabled={!url.trim()}
                onClick={() => {
                  void startDownload({ url: url.trim(), kind: "movie", title: title.trim() || filenameFromUrl(url) });
                  setUrl("");
                  setTitle("");
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" /> Start
              </button>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <p className="microlabel mb-3">Queue</p>
            {movieDownloads.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing downloading.</p>
            )}
            {movieDownloads.map((d) => (
              <div key={d.id} className="quiet-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{d.status}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {d.total > 0 ? `${fmtBytes(d.total * d.progress)} / ${fmtBytes(d.total)}` : ""}
                    </span>
                    {isDownloadActive(d.id) ? (
                      <button type="button" onClick={() => cancelDownload(d.id)} className="rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent">
                        Cancel
                      </button>
                    ) : (
                      (d.status === "done" || d.status === "error") && (
                        <button type="button" onClick={() => void deleteDownload(d.id)} className="rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent">
                          Clear
                        </button>
                      )
                    )}
                  </div>
                </div>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-foreground transition-all" style={{ width: `${Math.round(d.progress * 100)}%` }} />
                </div>
                {d.status === "error" && d.error && <p className="mt-2 text-xs text-destructive">{d.error}</p>}
                {d.status === "done" && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Film className="h-3 w-3" /> Ready — added to your library.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
