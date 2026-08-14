import { Download, Music2, Pause, Play, Plus, SkipBack, SkipForward, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import { useCollection, put, remove, deleteBlob, saveBlob, blobUrl, type Track, type DownloadTask } from "@/lib/db";
import { fmtBytes, fmtDuration, filenameFromUrl, relativeTime, uid } from "@/lib/format";
import { cancelDownload, deleteDownload, isDownloadActive, startDownload } from "@/lib/downloader";

export default function Music() {
  const tracks = useCollection<Track>("music");
  const downloads = useCollection<DownloadTask>("downloads");
  const [tab, setTab] = useState<"library" | "downloads">("library");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const sorted = [...tracks].sort((a, b) => b.createdAt - a.createdAt);
  const musicDownloads = downloads
    .filter((d) => d.kind === "music")
    .sort((a, b) => b.createdAt - a.createdAt);

  const current = tracks.find((t) => t.id === currentId) ?? null;

  // Convert finished music downloads into library tracks.
  useEffect(() => {
    musicDownloads.forEach((task) => {
      if (task.status === "done" && task.blobId && !tracks.some((t) => t.blobId === task.blobId)) {
        void (async () => {
          const audio = new Audio();
          const u = await blobUrl(task.blobId!);
          if (u) {
            audio.src = u;
            const duration = await new Promise<number>((resolve) => {
              audio.onloadedmetadata = () => resolve(audio.duration || 0);
              audio.onerror = () => resolve(0);
            });
            URL.revokeObjectURL(u);
            await put<Track>("music", {
              id: uid(),
              title: task.title,
              artist: "",
              album: "",
              blobId: task.blobId!,
              duration,
              createdAt: Date.now(),
              source: "url",
            });
          }
        })();
      }
    });
  }, [musicDownloads, tracks]);

  const playTrack = async (t: Track) => {
    if (currentId === t.id) {
      if (audioRef.current) {
        if (playing) audioRef.current.pause();
        else void audioRef.current.play();
      }
      return;
    }
    audioRef.current?.pause();
    const u = await blobUrl(t.blobId);
    if (!u) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = u;
    const audio = new Audio(u);
    audioRef.current = audio;
    audio.ontimeupdate = () => setTime(audio.currentTime);
    audio.onended = () => {
      setPlaying(false);
      next();
    };
    setCurrentId(t.id);
    setTime(0);
    await audio.play();
    setPlaying(true);
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: t.title,
          artist: t.artist || "Lifeflow",
          album: t.album || "",
        });
        navigator.mediaSession.setActionHandler("play", () => void audio.play());
        navigator.mediaSession.setActionHandler("pause", () => audio.pause());
        navigator.mediaSession.setActionHandler("nexttrack", () => next());
        navigator.mediaSession.setActionHandler("previoustrack", () => prev());
      } catch {
        /* older browsers */
      }
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else void audioRef.current.play();
  };

  const next = () => {
    const list = sorted;
    const idx = list.findIndex((t) => t.id === currentId);
    if (idx >= 0 && list[idx + 1]) void playTrack(list[idx + 1]);
  };

  const prev = () => {
    const list = sorted;
    const idx = list.findIndex((t) => t.id === currentId);
    if (idx > 0 && list[idx - 1]) void playTrack(list[idx - 1]);
  };

  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    let added = 0;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("audio/")) continue;
      const blobId = await saveBlob(f, f.type);
      const audio = new Audio();
      const u = await blobUrl(blobId);
      if (!u) continue;
      audio.src = u;
      const duration = await new Promise<number>((resolve) => {
        audio.onloadedmetadata = () => resolve(audio.duration || 0);
        audio.onerror = () => resolve(0);
      });
      URL.revokeObjectURL(u);
      const base = f.name.replace(/\.[a-z0-9]+$/i, "");
      const parts = base.split(/\s*[-–—]\s*/);
      await put<Track>("music", {
        id: uid(),
        title: parts.length > 1 ? parts[1].trim() : base,
        artist: parts.length > 1 ? parts[0].trim() : "Unknown artist",
        album: "",
        blobId,
        duration,
        createdAt: Date.now(),
        source: "device",
      });
      added++;
    }
    if (added > 0) toast(`${added} track${added > 1 ? "s" : ""} imported`);
  };

  const removeTrack = async (t: Track) => {
    if (currentId === t.id) {
      audioRef.current?.pause();
      setCurrentId(null);
      setPlaying(false);
    }
    await deleteBlob(t.blobId);
    await remove("music", t.id);
    toast("Track removed");
  };

  return (
    <div>
      <PageHeader
        eyebrow="Media"
        title="Music"
        description="Your library lives on this device — import files or accelerate downloads from any URL."
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
            <p className="microlabel">{sorted.length} tracks</p>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
              <Upload className="h-3.5 w-3.5" /> Import from device
              <input type="file" accept="audio/*" multiple className="hidden" onChange={(e) => { void importFiles(e.target.files); e.target.value = ""; }} />
            </label>
          </div>

          {sorted.length === 0 ? (
            <div className="quiet-card flex flex-col items-center p-12 text-center">
              <Music2 className="h-6 w-6 text-muted-foreground/50" />
              <p className="mt-3 text-sm text-muted-foreground">
                No music yet. Import files, or grab a download tab and paste a direct audio URL.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {sorted.map((t) => (
                <div
                  key={t.id}
                  className={`group flex items-center gap-3 rounded-md border p-3 transition-colors ${
                    currentId === t.id ? "border-foreground/50 bg-accent/40" : "hover:bg-accent/30"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void playTrack(t)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-foreground text-background transition-opacity hover:opacity-90"
                  >
                    {currentId === t.id && playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t.artist || "Unknown artist"} · {fmtDuration(t.duration)}
                    </p>
                  </div>
                  <span className="hidden text-[11px] text-muted-foreground/70 sm:block">
                    {t.source === "device" ? "device" : "download"} · {relativeTime(t.createdAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeTrack(t)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Player bar */}
          {current && (
            <div className="sticky bottom-4 mt-6 rounded-md border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
                  <Music2 className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{current.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{current.artist}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={prev} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
                    <SkipBack className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={togglePlay} className="flex h-10 w-10 items-center justify-center rounded-md bg-foreground text-background hover:opacity-90">
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={next} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
                    <SkipForward className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span className="w-12 text-right font-mono text-xs text-muted-foreground tabular-nums">
                  {fmtDuration(time)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={current.duration || 1}
                  value={Math.min(time, current.duration || 1)}
                  onChange={(e) => {
                    if (audioRef.current) {
                      audioRef.current.currentTime = Number(e.target.value);
                      setTime(Number(e.target.value));
                    }
                  }}
                  className="flex-1"
                />
                <span className="w-12 font-mono text-xs text-muted-foreground tabular-nums">
                  {fmtDuration(current.duration)}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "downloads" && (
        <div>
          <div className="quiet-card p-5">
            <p className="microlabel">Accelerated download</p>
            <p className="mt-1 mb-4 text-xs text-muted-foreground">
              Large files are pulled in parallel 4 MB chunks and resume where they left off.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…/track.mp3"
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
                  void startDownload({
                    url: url.trim(),
                    kind: "music",
                    title: title.trim() || filenameFromUrl(url),
                  });
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
            {musicDownloads.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing downloading.</p>
            )}
            {musicDownloads.map((d) => (
              <div key={d.id} className="quiet-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {d.url} · {d.status}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {d.total > 0 ? fmtBytes(d.total * d.progress) : ""}
                      {d.total > 0 ? ` / ${fmtBytes(d.total)}` : ""}
                    </span>
                    {isDownloadActive(d.id) ? (
                      <button
                        type="button"
                        onClick={() => cancelDownload(d.id)}
                        className="rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent"
                      >
                        Cancel
                      </button>
                    ) : (
                      (d.status === "done" || d.status === "error") && (
                        <button
                          type="button"
                          onClick={() => void deleteDownload(d.id)}
                          className="rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent"
                        >
                          Clear
                        </button>
                      )
                    )}
                  </div>
                </div>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-foreground transition-all"
                    style={{ width: `${Math.round(d.progress * 100)}%` }}
                  />
                </div>
                {d.status === "error" && d.error && (
                  <p className="mt-2 text-xs text-destructive">{d.error}</p>
                )}
                {d.status === "done" && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Download className="h-3 w-3" /> Ready — added to your library.
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
