import {
  Captions,
  Clapperboard,
  Download,
  Film,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import { useCollection, put, remove, deleteBlob, saveBlob, blobUrl, type Movie, type DownloadTask } from "@/lib/db";
import { fmtBytes, fmtDuration, filenameFromUrl, initialsOf, relativeTime, uid } from "@/lib/format";
import { cancelDownload, deleteDownload, isDownloadActive, startDownload } from "@/lib/downloader";
import { parseSubs } from "@/lib/subtitles";

function coverStyle(title: string): string {
  const hue = [...title].reduce((a, c) => a + c.charCodeAt(0), 0);
  return `linear-gradient(140deg, oklch(${0.16 + (hue % 10) / 100} ${0.015 + (hue % 2) / 100} ${(hue * 37) % 360}), oklch(${0.32 + (hue % 12) / 100} ${0.01 + (hue % 3) / 100} ${(hue * 61 + 30) % 360}))`;
}

export default function Movies() {
  const movies = useCollection<Movie>("movies");
  const downloads = useCollection<DownloadTask>("downloads");
  const [tab, setTab] = useState<"library" | "downloads">("library");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [subsOn, setSubsOn] = useState(true);
  const [controlsOn, setControlsOn] = useState(true);
  const [isFs, setIsFs] = useState(false);
  const [query, setQuery] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fsRef = useRef<HTMLDivElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const lastSave = useRef(0);
  const resumedRef = useRef(false);
  const speedRef = useRef(1);
  const trackRef = useRef<TextTrack | null>(null);
  const hideTimer = useRef<number | null>(null);

  const sorted = [...movies].sort((a, b) => b.createdAt - a.createdAt);
  const movieDownloads = downloads.filter((d) => d.kind === "movie").sort((a, b) => b.createdAt - a.createdAt);
  const player = movies.find((m) => m.id === playerId) ?? null;

  const q = query.trim().toLowerCase();
  const filtered = q ? sorted.filter((m) => m.title.toLowerCase().includes(q)) : sorted;
  const inProgress = filtered.filter((m) => m.progress > 5);
  const unwatched = filtered.filter((m) => m.progress <= 5);

  /* --------------------------- downloads → library ------------------------ */

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

  useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  /* ------------------------------ player load ----------------------------- */

  useEffect(() => {
    const m = movies.find((x) => x.id === playerId) ?? null;
    const video = videoRef.current;
    if (!m || !video) return;
    let alive = true;
    resumedRef.current = false;
    trackRef.current = null;
    (async () => {
      const u = await blobUrl(m.blobId);
      if (!alive || !u) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = u;
      video.src = u;
      video.playbackRate = speedRef.current;
      video.volume = volume;
      video.muted = muted;
      video.ontimeupdate = () => {
        setTime(video.currentTime);
        if (video.buffered.length > 0) setBuffered(video.buffered.end(video.buffered.length - 1));
        const now = Date.now();
        if (now - lastSave.current > 5000) {
          lastSave.current = now;
          void put<Movie>("movies", { ...m, progress: video.currentTime });
        }
      };
      video.onloadedmetadata = () => {
        if (m.progress > 0 && !resumedRef.current) {
          resumedRef.current = true;
          video.currentTime = m.progress;
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
      if (m.subtitleText) {
        const track = video.addTextTrack("subtitles", "en", "en");
        track.mode = "showing";
        trackRef.current = track;
        if (typeof VTTCue !== "undefined") {
          for (const cue of parseSubs(m.subtitleText)) {
            try {
              track.addCue(new VTTCue(cue.start, cue.end, cue.text));
            } catch {
              /* skip malformed cue */
            }
          }
        }
      }
      void video.play().catch(() => undefined);
    })();
    return () => {
      alive = false;
    };
  }, [playerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (trackRef.current) trackRef.current.mode = subsOn ? "showing" : "hidden";
  }, [subsOn]);

  /* ------------------------------ player UI ------------------------------- */

  const open = (m: Movie) => {
    setPlayerId(m.id);
    setTime(0);
    setBuffered(0);
    setControlsOn(true);
  };

  const close = () => {
    setPlayerId(null);
    setPlaying(false);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  const seekBy = (d: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d));
  };

  const changeVolume = (v: number) => {
    setVolume(v);
    setMuted(v === 0);
    if (videoRef.current) {
      videoRef.current.volume = v;
      videoRef.current.muted = v === 0;
    }
  };

  const changeSpeed = (s: number) => {
    setSpeed(s);
    speedRef.current = s;
    if (videoRef.current) videoRef.current.playbackRate = s;
  };

  const toggleFullscreen = async () => {
    const el = fsRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      /* unsupported */
    }
  };

  const pip = async () => {
    const v = videoRef.current;
    if (!v || typeof v.requestPictureInPicture !== "function") return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {
      /* unsupported */
    }
  };

  useEffect(() => {
    const onFs = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Auto-hide controls + keyboard shortcuts while the player is open.
  useEffect(() => {
    if (!player) return;
    const wake = () => {
      setControlsOn(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (!videoRef.current?.paused) hideTimer.current = window.setTimeout(() => setControlsOn(false), 2600);
    };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          seekBy(-10);
          break;
        case "ArrowRight":
          seekBy(10);
          break;
        case "ArrowUp":
          e.preventDefault();
          changeVolume(Math.min(1, volume + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          changeVolume(Math.max(0, volume - 0.1));
          break;
        case "m":
          setMuted((x) => {
            const nx = !x;
            if (videoRef.current) videoRef.current.muted = nx;
            return nx;
          });
          break;
        case "c":
          setSubsOn((x) => !x);
          break;
        case "f":
          void toggleFullscreen();
          break;
        case "Escape":
          if (!document.fullscreenElement) close();
          break;
      }
      wake();
    };
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", onKey);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, volume, muted]);

  const subBtnCls = (active: boolean) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ${active ? "bg-white/90 text-black" : "bg-white/10 text-white hover:bg-white/20"}`;

  /* -------------------------------- library ------------------------------- */

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

  const attachSubs = async (m: Movie, file: File) => {
    const text = await file.text();
    if (!text.includes("-->")) return toast("That doesn't look like a subtitle file (.srt or .vtt)");
    await put<Movie>("movies", { ...m, subtitleText: text });
    toast("Subtitles attached");
  };

  const removeMovie = async (m: Movie) => {
    if (playerId === m.id) close();
    await deleteBlob(m.blobId);
    await remove("movies", m.id);
    toast("Film removed");
  };

  const Card = ({ m }: { m: Movie }) => {
    const pct = m.duration > 0 ? Math.min(100, (m.progress / m.duration) * 100) : 0;
    return (
      <div className="group relative">
        <button
          type="button"
          onClick={() => open(m)}
          className="relative block aspect-video w-full overflow-hidden rounded-md text-left focus:outline-none"
          style={{ background: coverStyle(m.title) }}
        >
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur-sm transition-all group-hover:opacity-100">
              <Play className="ml-0.5 h-5 w-5" />
            </span>
          </span>
          <span className="absolute top-2.5 left-3 text-lg font-semibold tracking-tight text-white/95">{initialsOf(m.title)}</span>
          {m.subtitleText && (
            <span className="absolute top-2.5 right-2.5 flex h-6 w-6 items-center justify-center rounded bg-black/40 text-white">
              <Captions className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
            <span className="block h-full bg-white/90" style={{ width: `${pct}%` }} />
          </span>
        </button>
        <div className="mt-2 flex items-start justify-between gap-2">
          <button type="button" onClick={() => open(m)} className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-medium">{m.title}</p>
            <p className="text-[11px] text-muted-foreground">
              {fmtDuration(m.duration)} · {pct > 0 ? `${Math.round(pct)}% watched` : "not started"}
            </p>
          </button>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <label className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent" title="Attach subtitles">
              <Captions className="h-3.5 w-3.5" />
              <input type="file" accept=".srt,.vtt,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachSubs(m, f); e.target.value = ""; }} />
            </label>
            <button type="button" onClick={() => void removeMovie(m)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        eyebrow="Media"
        title="Movies"
        description="A cinematic player on your device — subtitles, speed, PiP, and resume where you left off."
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
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="microlabel">{filtered.length} film{filtered.length === 1 ? "" : "s"}</p>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search films" className="w-36 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60" />
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
                <Upload className="h-3.5 w-3.5" /> Import
                <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => { void importFiles(e.target.files); e.target.value = ""; }} />
              </label>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="quiet-card flex flex-col items-center p-12 text-center">
              <Clapperboard className="h-6 w-6 text-muted-foreground/50" />
              <p className="mt-3 text-sm text-muted-foreground">No films yet. Import files, or paste a direct video URL in Downloads.</p>
            </div>
          ) : (
            <>
              {inProgress.length > 0 && (
                <>
                  <p className="microlabel mb-3">Continue watching</p>
                  <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {inProgress.map((m) => (
                      <Card key={m.id} m={m} />
                    ))}
                  </div>
                </>
              )}
              {unwatched.length > 0 && (
                <>
                  <p className="microlabel mb-3">Library</p>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {unwatched.map((m) => (
                      <Card key={m.id} m={m} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* Full-screen player */}
          <AnimatePresence>
            {player && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                ref={fsRef}
                className="fixed inset-0 z-40 bg-black"
              >
                <video ref={videoRef} className="h-full w-full" playsInline onClick={togglePlay} />

                {/* Center play */}
                {!playing && (
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-transform hover:scale-105">
                      <Play className="ml-1 h-9 w-9" />
                    </span>
                  </button>
                )}

                {/* Top bar */}
                <div className={`absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent px-5 pt-4 pb-10 transition-opacity duration-300 ${controlsOn ? "opacity-100" : "pointer-events-none opacity-0"}`}>
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={close} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-white transition-colors hover:bg-white/10">
                      <X className="h-4 w-4" /> Back
                    </button>
                    <div className="min-w-0 text-center">
                      <p className="truncate text-sm font-medium text-white">{player.title}</p>
                      <p className="text-[11px] text-white/60">
                        {fmtDuration(player.duration)} · {player.progress > 5 ? `${Math.round((player.progress / Math.max(player.duration, 1)) * 100)}%` : "new"}
                      </p>
                    </div>
                    <div className="w-16" />
                  </div>
                </div>

                {/* Bottom bar */}
                <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-5 pt-10 pb-4 transition-opacity duration-300 ${controlsOn ? "opacity-100" : "pointer-events-none opacity-0"}`}>
                  <input
                    type="range"
                    min={0}
                    max={player.duration || 1}
                    value={Math.min(time, player.duration || 1)}
                    onChange={(e) => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = Number(e.target.value);
                        setTime(Number(e.target.value));
                      }
                    }}
                    className="w-full"
                    style={{
                      background: `linear-gradient(to right, #fff 0%, #fff ${Math.min(100, (time / Math.max(player.duration, 1)) * 100)}%, rgba(255,255,255,0.25) ${Math.min(100, (time / Math.max(player.duration, 1)) * 100)}%)`,
                    }}
                  />
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="font-mono text-xs text-white/80 tabular-nums">{fmtDuration(time)} / {fmtDuration(player.duration)}</span>
                    <span className="hidden font-mono text-[11px] text-white/50 sm:block">
                      Space play · ←/→ seek · ↑/↓ volume · F fullscreen · C subs
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-center gap-2">
                    <button type="button" onClick={togglePlay} className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105">
                      {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                    </button>
                    <button type="button" onClick={() => seekBy(-10)} className="flex h-9 w-9 items-center justify-center rounded-md text-white transition-colors hover:bg-white/10" title="-10s">
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => seekBy(10)} className="flex h-9 w-9 items-center justify-center rounded-md text-white transition-colors hover:bg-white/10" title="+10s">
                      <RotateCw className="h-4 w-4" />
                    </button>
                    <div className="mx-1 flex items-center gap-2 rounded-md bg-white/10 px-2 py-1.5">
                      <Volume2 className="h-4 w-4 text-white" />
                      <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} onChange={(e) => changeVolume(Number(e.target.value))} className="w-20" />
                    </div>
                    <select value={speed} onChange={(e) => changeSpeed(Number(e.target.value))} className="rounded-md bg-white/10 px-2 py-1.5 text-xs text-white outline-none [&>option]:bg-black">
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                        <option key={s} value={s}>{s}×</option>
                      ))}
                    </select>
                    {player.subtitleText && (
                      <button type="button" onClick={() => setSubsOn((x) => !x)} className={subBtnCls(subsOn)}>
                        <Captions className="h-3.5 w-3.5" /> {subsOn ? "On" : "Off"}
                      </button>
                    )}
                    <button type="button" onClick={() => void pip()} className="flex h-9 items-center justify-center rounded-md bg-white/10 px-2.5 text-white transition-colors hover:bg-white/20" title="Picture in picture">
                      <PictureInPicture2 className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => void toggleFullscreen()} className="flex h-9 w-9 items-center justify-center rounded-md text-white transition-colors hover:bg-white/10" title="Fullscreen">
                      {isFs ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {tab === "downloads" && (
        <div>
          <div className="quiet-card p-5">
            <p className="microlabel">Accelerated download</p>
            <p className="mt-1 mb-4 text-xs text-muted-foreground">Parallel chunked downloads with resume — faster than a single stream.</p>
            <div className="flex flex-wrap gap-2">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/film.mp4" className="min-w-0 flex-1 rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40" />
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-44 rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40" />
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
            {movieDownloads.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nothing downloading.</p>}
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
                      <button type="button" onClick={() => cancelDownload(d.id)} className="rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent">Cancel</button>
                    ) : (
                      (d.status === "done" || d.status === "error") && (
                        <button type="button" onClick={() => void deleteDownload(d.id)} className="rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent">Clear</button>
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
