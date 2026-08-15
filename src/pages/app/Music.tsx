import {
  Download,
  HardDrive,
  ListMusic,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Timer,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import DownloadForm from "@/components/app/DownloadForm";
import FreeLibraryBrowser from "@/components/app/FreeLibraryBrowser";
import PageHeader from "@/components/app/PageHeader";
import BlobImage from "@/components/BlobImage";
import { useCollection, put, remove, deleteBlob, saveBlob, blobUrl, type Track, type DownloadTask, type Playlist } from "@/lib/db";
import { fmtBytes, fmtDuration, initialsOf, relativeTime, uid } from "@/lib/format";
import { cancelDownload, deleteDownload, isDownloadActive } from "@/lib/downloader";
import { isMediaLibraryAvailable, scanLibrary, importLibraryItem, type LibraryItem } from "@/lib/medialibrary";
import { notify } from "@/lib/notifications";

const EQ_BANDS = [
  { key: "low", label: "Bass", freq: 200 },
  { key: "mid", label: "Mid", freq: 1000 },
  { key: "high", label: "Treble", freq: 3500 },
] as const;

function coverStyle(title: string): string {
  const hue = [...title].reduce((a, c) => a + c.charCodeAt(0), 0);
  const c1 = `oklch(${0.28 + (hue % 14) / 100} ${0.02 + (hue % 3) / 100} ${(hue * 37) % 360})`;
  const c2 = `oklch(${0.45 + (hue % 10) / 100} ${0.01 + (hue % 2) / 100} ${(hue * 53 + 40) % 360})`;
  return `linear-gradient(135deg, ${c1}, ${c2})`;
}

export default function Music() {
  const tracks = useCollection<Track>("music");
  const downloads = useCollection<DownloadTask>("downloads");
  const playlists = useCollection<Playlist>("playlists");
  const [tab, setTab] = useState<"library" | "downloads" | "browse">("library");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [buffered, setBuffered] = useState(0);

  const [npOpen, setNpOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<{ title: string; artist: string; album: string }>({ title: "", artist: "", album: "" });
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueList, setQueueList] = useState<Track[]>([]);
  const [volume, setVolume] = useState(1);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off");
  const [speed, setSpeed] = useState(1);
  const [sleepMin, setSleepMin] = useState<number | null>(null);
  const [eqOn, setEqOn] = useState(false);
  const [eqPanel, setEqPanel] = useState(false);
  const [eq, setEq] = useState({ low: 0, mid: 0, high: 0 });
  const [newPlaylist, setNewPlaylist] = useState("");
  const [addTo, setAddTo] = useState<Track | null>(null);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "title" | "artist">("recent");
  const [scanning, setScanning] = useState(false);
  const [deviceItems, setDeviceItems] = useState<LibraryItem[] | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const queueRef = useRef<Track[]>([]);
  const sleepTimerRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const eqNodesRef = useRef<BiquadFilterNode[] | null>(null);
  const vizCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const vizRaf = useRef<number | null>(null);

  const sorted = [...tracks].sort((a, b) => b.createdAt - a.createdAt);
  const musicDownloads = downloads.filter((d) => d.kind === "music").sort((a, b) => b.createdAt - a.createdAt);
  const current = tracks.find((t) => t.id === currentId) ?? null;

  const filtered = useFilteredTracks(sorted, query, sortBy);

  /* ------------------------------ audio graph ----------------------------- */

  const teardownGraph = () => {
    eqNodesRef.current = null;
    if (ctxRef.current) void ctxRef.current.close().catch(() => undefined);
    ctxRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
  };

  const ensureGraph = async () => {
    if (ctxRef.current || !audioRef.current) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    ctxRef.current = ctx;
    await ctx.resume().catch(() => undefined);
    const source = ctx.createMediaElementSource(audioRef.current);
    sourceRef.current = source;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    analyserRef.current = analyser;
  };

  const toggleEqBranch = (on: boolean) => {
    const ctx = ctxRef.current;
    const source = sourceRef.current;
    if (!ctx || !source) return;
    if (on && !eqNodesRef.current) {
      const gains = EQ_BANDS.map((band) => {
        const f = ctx.createBiquadFilter();
        f.type = band.key === "mid" ? "peaking" : band.key === "low" ? "lowshelf" : "highshelf";
        f.frequency.value = band.freq;
        if (band.key === "mid") f.Q.value = 1;
        return f;
      });
      source.connect(gains[0]);
      gains[0].connect(gains[1]);
      gains[1].connect(gains[2]);
      gains[2].connect(ctx.destination);
      eqNodesRef.current = gains;
    }
    if (!on && eqNodesRef.current) {
      try {
        source.disconnect(eqNodesRef.current[0]);
      } catch {
        /* noop */
      }
      eqNodesRef.current = null;
    }
    if (eqNodesRef.current) {
      eqNodesRef.current.forEach((g, i) => (g.gain.value = [eq.low, eq.mid, eq.high][i]));
    }
  };

  useEffect(() => {
    toggleEqBranch(eqOn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eqOn]);

  useEffect(() => {
    if (eqNodesRef.current) eqNodesRef.current.forEach((g, i) => (g.gain.value = [eq.low, eq.mid, eq.high][i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eq.low, eq.mid, eq.high]);

  /* ------------------------------ visualizer ------------------------------ */

  const drawViz = () => {
    const canvas = vizCanvasRef.current;
    vizRaf.current = requestAnimationFrame(drawViz);
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx2d.clearRect(0, 0, W, H);
    const fg = getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim() || "oklch(0.2 0 0)";
    const n = 56;
    const barW = W / n;
    const analyser = analyserRef.current;
    if (analyser) {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      for (let i = 0; i < n; i++) {
        const idx = Math.min(data.length - 1, Math.floor((i / n) * data.length * 0.85));
        const v = data[idx] / 255;
        const h = Math.max(3, v * H * 0.92);
        ctx2d.fillStyle = `${fg} / ${0.35 + v * 0.6}`;
        ctx2d.fillRect(i * barW + 1, H - h, Math.max(2, barW - 2), h);
      }
    } else {
      const t = Date.now() / 420;
      for (let i = 0; i < n; i++) {
        const h = 4 + Math.abs(Math.sin(t + i * 0.35)) * H * 0.35;
        ctx2d.fillStyle = `${fg} / 0.28`;
        ctx2d.fillRect(i * barW + 1, H - h, Math.max(2, barW - 2), h);
      }
    }
  };

  useEffect(() => {
    if (!npOpen) return;
    vizRaf.current = requestAnimationFrame(drawViz);
    return () => {
      if (vizRaf.current) cancelAnimationFrame(vizRaf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [npOpen]);

  /* --------------------------- downloads → library ------------------------ */

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

  useEffect(() => {
    return () => {
      if (sleepTimerRef.current) window.clearTimeout(sleepTimerRef.current);
      if (vizRaf.current) cancelAnimationFrame(vizRaf.current);
      teardownGraph();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  /* -------------------------------- player -------------------------------- */

  const pickNext = (): Track | null => {
    const queue = queueRef.current.length > 0 ? queueRef.current : sorted;
    if (queue.length === 0) return null;
    const idx = queue.findIndex((t) => t.id === currentId);
    if (shuffle && queue.length > 1) {
      let r = idx;
      while (r === idx) r = Math.floor(Math.random() * queue.length);
      return queue[r];
    }
    const next = idx + 1;
    if (next < queue.length) return queue[next];
    return repeatMode === "all" && queue.length > 0 ? queue[0] : null;
  };

  const playTrack = async (t: Track, queue?: Track[]) => {
    if (queue) {
      queueRef.current = queue;
      setQueueList(queue);
    }
    if (currentId === t.id) {
      if (audioRef.current) {
        if (playing) audioRef.current.pause();
        else void audioRef.current.play();
      }
      return;
    }
    audioRef.current?.pause();
    teardownGraph();
    const u = await blobUrl(t.blobId);
    if (!u) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = u;
    const audio = new Audio(u);
    audioRef.current = audio;
    audio.playbackRate = speed;
    audio.volume = volume;
    audio.ontimeupdate = () => {
      setTime(audio.currentTime);
      if (audio.buffered.length > 0) setBuffered(audio.buffered.end(audio.buffered.length - 1));
    };
    audio.onended = () => {
      if (repeatMode === "one") {
        audio.currentTime = 0;
        void audio.play();
        return;
      }
      const nxt = pickNext();
      if (nxt) void playTrack(nxt);
      else setPlaying(false);
    };
    setCurrentId(t.id);
    setTime(0);
    setBuffered(0);
    await audio.play();
    setPlaying(true);
    void ensureGraph().then(() => toggleEqBranch(eqOn));
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: t.title,
          artist: t.artist || "Lifeflow",
          album: t.album || "",
        });
        navigator.mediaSession.setActionHandler("play", () => void audio.play());
        navigator.mediaSession.setActionHandler("pause", () => audio.pause());
        navigator.mediaSession.setActionHandler("nexttrack", () => {
          const nxt = pickNext();
          if (nxt) void playTrack(nxt);
        });
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
    const nxt = pickNext();
    if (nxt) void playTrack(nxt);
  };

  const prev = () => {
    const queue = queueRef.current.length > 0 ? queueRef.current : sorted;
    const idx = queue.findIndex((t) => t.id === currentId);
    if (idx > 0 && queue[idx - 1]) void playTrack(queue[idx - 1]);
    else if (queue.length > 0) void playTrack(queue[0]);
  };

  const setSleep = (m: number | null) => {
    if (sleepTimerRef.current) {
      window.clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    setSleepMin(m);
    if (m) {
      sleepTimerRef.current = window.setTimeout(() => {
        audioRef.current?.pause();
        setPlaying(false);
        setSleepMin(null);
        notify("Sleep timer", "Playback paused.");
      }, m * 60_000);
    }
  };

  const changeSpeed = (s: number) => {
    setSpeed(s);
    if (audioRef.current) audioRef.current.playbackRate = s;
  };

  const changeVolume = (v: number) => {
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v;
  };

  const saveEdit = async (t: Track) => {
    await put<Track>("music", {
      ...t,
      title: editDraft.title.trim() || t.title,
      artist: editDraft.artist.trim(),
      album: editDraft.album.trim(),
    });
    setEditing(false);
    toast("Metadata saved");
  };

  const setCover = async (t: Track, file: File) => {
    if (t.coverBlobId) await deleteBlob(t.coverBlobId);
    const id = await saveBlob(file, file.type);
    await put<Track>("music", { ...t, coverBlobId: id });
    toast("Cover updated");
  };

  /* -------------------------------- library ------------------------------- */

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

  const scanDevice = async () => {
    setScanning(true);
    try {
      const items = await scanLibrary("audio");
      setDeviceItems(items);
      if (items.length === 0) toast("No audio found on this device");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not scan the device library");
    } finally {
      setScanning(false);
    }
  };

  const importFromLibrary = async (item: LibraryItem) => {
    try {
      const url = await importLibraryItem(item);
      if (!url) return;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobId = await saveBlob(blob, item.mime || "audio/mpeg");
      await put<Track>("music", {
        id: uid(),
        title: item.name.replace(/\.[a-z0-9]+$/i, ""),
        artist: item.artist || "Unknown artist",
        album: item.album || "",
        blobId,
        duration: item.duration || 0,
        createdAt: Date.now(),
        source: "device",
      });
      toast(`Added ${item.name}`);
    } catch {
      toast("Couldn't import that file");
    }
  };

  const removeTrack = async (t: Track) => {
    if (currentId === t.id) {
      audioRef.current?.pause();
      setCurrentId(null);
      setPlaying(false);
      setNpOpen(false);
    }
    await deleteBlob(t.blobId);
    if (t.coverBlobId) await deleteBlob(t.coverBlobId);
    await remove("music", t.id);
    toast("Track removed");
  };

  const createPlaylist = async () => {
    const n = newPlaylist.trim();
    if (!n) return;
    await put<Playlist>("playlists", { id: uid(), name: n, trackIds: [], createdAt: Date.now() });
    setNewPlaylist("");
  };

  const addToPlaylist = async (p: Playlist, t: Track) => {
    if (!p.trackIds.includes(t.id)) {
      await put<Playlist>("playlists", { ...p, trackIds: [...p.trackIds, t.id] });
    }
    toast(`Added to ${p.name}`);
    setAddTo(null);
  };

  const playPlaylist = (p: Playlist) => {
    const list = p.trackIds.map((id) => tracks.find((t) => t.id === id)).filter((t): t is Track => Boolean(t));
    if (list.length === 0) return toast("That playlist is empty");
    void playTrack(list[0], list);
  };

  const deletePlaylist = async (p: Playlist) => {
    await remove("playlists", p.id);
  };

  const inputCls = "rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40";

  return (
    <div>
      <PageHeader
        eyebrow="Media"
        title="Music"
        description="Your library lives on this device — playlists, equalizer, visualizer, sleep timer, accelerated downloads."
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
            <button
              type="button"
              onClick={() => setTab("browse")}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${tab === "browse" ? "bg-foreground text-background" : "hover:bg-accent"}`}
            >
              Browse
            </button>
          </div>
        }
      />

      {tab === "library" && (
        <>
          {/* Playlists */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <ListMusic className="h-4 w-4 shrink-0 text-muted-foreground" />
            {playlists.map((p) => (
              <span key={p.id} className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs">
                <button type="button" onClick={() => playPlaylist(p)} className="transition-colors hover:text-foreground">
                  {p.name} · {p.trackIds.length}
                </button>
                <button
                  type="button"
                  onClick={() => void deletePlaylist(p)}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  title="Delete playlist"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <div className="flex items-center gap-1">
              <input
                value={newPlaylist}
                onChange={(e) => setNewPlaylist(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createPlaylist();
                }}
                placeholder="New playlist"
                className="w-28 rounded-md border bg-transparent px-2 py-1 text-xs outline-none focus:border-foreground/40"
              />
              <button
                type="button"
                onClick={() => void createPlaylist()}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Library toolbar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="microlabel">{filtered.length} track{filtered.length === 1 ? "" : "s"}</p>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search library"
                  className="w-36 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="rounded-md border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-foreground/40"
              >
                <option value="recent">Recent</option>
                <option value="title">Title</option>
                <option value="artist">Artist</option>
              </select>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
                <Upload className="h-3.5 w-3.5" /> Import
                <input
                  type="file"
                  accept="audio/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { void importFiles((e.target as HTMLInputElement).files); e.target.value = ""; }}
                />
              </label>
              {isMediaLibraryAvailable() && (
                <button
                  type="button"
                  onClick={() => void scanDevice()}
                  disabled={scanning}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40"
                >
                  <HardDrive className="h-3.5 w-3.5" /> {scanning ? "Scanning…" : "Scan device"}
                </button>
              )}
            </div>
          </div>

          {deviceItems !== null && (
            <div className="mb-4 rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="microlabel">On your device · {deviceItems.length}</p>
                <button type="button" onClick={() => setDeviceItems(null)} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                  Close
                </button>
              </div>
              {deviceItems.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No audio found.</p>
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {deviceItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.artist || "Unknown artist"} · {fmtBytes(item.size)}
                        </p>
                      </div>
                      <button type="button" onClick={() => void importFromLibrary(item)} className="shrink-0 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-accent">
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="quiet-card flex flex-col items-center p-12 text-center">
              <Music2 className="h-6 w-6 text-muted-foreground/50" />
              <p className="mt-3 text-sm text-muted-foreground">
                No music yet. Import files, or grab a download tab and paste a direct audio URL.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((t, i) => (
                <div
                  key={t.id}
                  className={`group relative flex items-center gap-3 rounded-lg border p-3 transition-all hover:bg-accent/30 ${
                    currentId === t.id ? "border-foreground/50 bg-accent/40" : ""
                  }`}
                >
                  <span className="w-5 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground/50">{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => void playTrack(t)}
                    className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-foreground text-background shadow-sm transition-all hover:scale-105 hover:opacity-90"
                    style={t.coverBlobId ? undefined : { background: coverStyle(t.title) }}
                  >
                    {t.coverBlobId ? (
                      <BlobImage blobId={t.coverBlobId} className="h-full w-full object-cover" />
                    ) : currentId === t.id && playing ? (
                      <Pause className="h-4 w-4 text-white" />
                    ) : (
                      <Play className="h-4 w-4 text-white" />
                    )}
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
                    onClick={() => setAddTo(addTo?.id === t.id ? null : t)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-accent group-hover:opacity-100"
                    title="Add to playlist"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  {addTo?.id === t.id && (
                    <div className="absolute top-full right-8 z-10 mt-1 w-48 rounded-md border bg-card p-1 shadow-md">
                      {playlists.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">No playlists yet</p>}
                      {playlists.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => void addToPlaylist(p, t)}
                          className="block w-full rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                        >
                          {p.name}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={async () => {
                          const n = window.prompt("Playlist name");
                          if (n?.trim()) {
                            await put<Playlist>("playlists", { id: uid(), name: n.trim(), trackIds: [t.id], createdAt: Date.now() });
                            toast(`Created "${n.trim()}"`);
                          }
                          setAddTo(null);
                        }}
                        className="mt-1 block w-full rounded border-t px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-accent"
                      >
                        + New playlist
                      </button>
                    </div>
                  )}
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

          {/* Mini player */}
          {current && (
            <div className="sticky bottom-4 mt-6 flex items-center gap-3 rounded-md border bg-card p-3 shadow-sm">
              <button
                type="button"
                onClick={() => setNpOpen(true)}
                className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-semibold text-white shadow-sm"
                style={current.coverBlobId ? undefined : { background: coverStyle(current.title) }}
              >
                {current.coverBlobId ? (
                  <BlobImage blobId={current.coverBlobId} className="h-full w-full object-cover" />
                ) : (
                  initialsOf(current.title)
                )}
              </button>
              <button type="button" onClick={() => setNpOpen(true)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium">{current.title}</p>
                <p className="truncate text-xs text-muted-foreground">{current.artist || "Unknown artist"}</p>
              </button>
              <button
                type="button"
                onClick={togglePlay}
                className="flex h-9 w-9 items-center justify-center rounded-md bg-foreground text-background transition-opacity hover:opacity-90"
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={next}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Now playing — full screen */}
          <AnimatePresence>
            {npOpen && current && (
              <motion.div
                initial={{ opacity: 0, y: 48 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 48 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-background"
              >
                {/* Ambient color wash from the cover */}
                <div className="pointer-events-none absolute inset-0 opacity-30 blur-3xl" style={{ background: coverStyle(current.title) }} />
                <div className="relative z-10 flex items-center justify-between px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setNpOpen(false)}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
                  >
                    <X className="h-5 w-5" />
                  </button>
                  <p className="microlabel">Now playing</p>
                  <div className="w-9" />
                </div>

                <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6 pb-8">
                  {/* Cover */}
                  <div
                    className="relative flex h-56 w-56 items-center justify-center overflow-hidden rounded-2xl shadow-2xl md:h-72 md:w-72"
                    style={current.coverBlobId ? undefined : { background: coverStyle(current.title) }}
                  >
                    {current.coverBlobId ? (
                      <BlobImage blobId={current.coverBlobId} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-5xl font-semibold tracking-tight text-white/90">{initialsOf(current.title)}</span>
                    )}
                    <label className="absolute right-2 bottom-2 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 hover:opacity-100" title="Set cover art">
                      <Upload className="h-4 w-4" />
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && current) void setCover(current, f); e.target.value = ""; }} />
                    </label>
                  </div>

                  {/* Title */}
                  <div className="w-full max-w-xl text-center">
                    {editing ? (
                      <div className="space-y-2">
                        <input value={editDraft.title} onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} className={`${inputCls} w-full text-center`} />
                        <div className="flex gap-2">
                          <input value={editDraft.artist} onChange={(e) => setEditDraft({ ...editDraft, artist: e.target.value })} placeholder="Artist" className={`${inputCls} flex-1`} />
                          <input value={editDraft.album} onChange={(e) => setEditDraft({ ...editDraft, album: e.target.value })} placeholder="Album" className={`${inputCls} flex-1`} />
                        </div>
                        <div className="flex justify-center gap-2">
                          <button type="button" onClick={() => current && void saveEdit(current)} className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background">Save</button>
                          <button type="button" onClick={() => setEditing(false)} className="rounded-md border px-3 py-1.5 text-xs">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">{current.title}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {current.artist || "Unknown artist"}
                          {current.album ? ` · ${current.album}` : ""}
                        </p>
                      </>
                    )}
                  </div>

                  {/* Visualizer */}
                  <canvas ref={vizCanvasRef} width={640} height={132} className="h-20 w-full max-w-xl" />

                  {/* Seek */}
                  <div className="w-full max-w-xl">
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
                      className="w-full"
                      style={{
                        background: `linear-gradient(to right, var(--foreground) 0%, var(--foreground) ${buffered > 0 ? Math.min(100, (buffered / Math.max(current.duration, 1)) * 100) : 0}%, var(--muted) ${buffered > 0 ? Math.min(100, (buffered / Math.max(current.duration, 1)) * 100) : 0}%)`,
                      }}
                    />
                    <div className="mt-1 flex justify-between font-mono text-xs text-muted-foreground tabular-nums">
                      <span>{fmtDuration(time)}</span>
                      <span>{fmtDuration(current.duration)}</span>
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setShuffle((s) => !s)}
                      className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${shuffle ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent"}`}
                      title="Shuffle"
                    >
                      <Shuffle className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={prev} className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
                      <SkipBack className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition-transform hover:scale-105"
                    >
                      {playing ? <Pause className="h-7 w-7" /> : <Play className="ml-1 h-7 w-7" />}
                    </button>
                    <button type="button" onClick={next} className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
                      <SkipForward className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRepeatMode((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"))}
                      className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${repeatMode !== "off" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent"}`}
                      title={repeatMode === "one" ? "Repeat one" : repeatMode === "all" ? "Repeat all" : "Repeat off"}
                    >
                      {repeatMode === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
                    </button>
                  </div>

                  {/* Secondary controls */}
                  <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
                    <div className="flex items-center gap-1.5 rounded-md border px-2 py-1.5">
                      <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => changeVolume(Number(e.target.value))} className="w-20" />
                    </div>
                    <select value={speed} onChange={(e) => changeSpeed(Number(e.target.value))} className="rounded-md border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-foreground/40">
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                        <option key={s} value={s}>{s}×</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const opts = [5, 10, 15, 30, 60] as const;
                        const nextVal = sleepMin ? null : opts[0];
                        if (sleepMin === null) {
                          const pick = window.prompt(`Sleep timer (minutes): ${opts.join(", ")}`, "15");
                          const n = Number(pick);
                          setSleep(Number.isFinite(n) && n > 0 ? n : null);
                        } else {
                          setSleep(null);
                        }
                      }}
                      className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors ${sleepMin ? "bg-foreground text-background" : "hover:bg-accent"}`}
                    >
                      <Timer className="h-3.5 w-3.5" /> {sleepMin ? `${sleepMin}m` : "Sleep"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEqOn((v) => !v)}
                      className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors ${eqOn ? "bg-foreground text-background" : "hover:bg-accent"}`}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" /> EQ
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(true);
                        setEditDraft({ title: current.title, artist: current.artist, album: current.album });
                      }}
                      className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors hover:bg-accent"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setQueueOpen((v) => !v)}
                      className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors ${queueOpen ? "bg-foreground text-background" : "hover:bg-accent"}`}
                    >
                      <ListMusic className="h-3.5 w-3.5" /> Queue
                    </button>
                  </div>

                  {/* EQ panel */}
                  {eqOn && (
                    <div className="flex w-full max-w-xl items-center gap-5 rounded-md border p-4">
                      {EQ_BANDS.map((band) => (
                        <label key={band.key} className="flex flex-1 flex-col items-center gap-1.5 text-[10px] text-muted-foreground">
                          {band.label}
                          <input
                            type="range"
                            min={-12}
                            max={12}
                            step={1}
                            value={eq[band.key]}
                            onChange={(e) => setEq((prev) => ({ ...prev, [band.key]: Number(e.target.value) }))}
                            className="w-full"
                          />
                          <span className="font-mono tabular-nums">{eq[band.key] > 0 ? `+${eq[band.key]}` : eq[band.key]} dB</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Queue */}
                  {queueOpen && (
                    <div className="w-full max-w-xl rounded-md border">
                      <div className="flex items-center justify-between border-b px-4 py-2.5">
                        <p className="text-xs font-medium">Up next · {queueList.length}</p>
                        <button type="button" onClick={() => { queueRef.current = []; setQueueList([]); }} className="text-[11px] text-muted-foreground hover:text-foreground">
                          Clear
                        </button>
                      </div>
                      {queueList.length === 0 ? (
                        <p className="px-4 py-6 text-center text-xs text-muted-foreground">Queue is the current view — play a playlist or browse to fill it.</p>
                      ) : (
                        <ul className="max-h-56 space-y-0.5 overflow-y-auto p-1.5">
                          {queueList.map((t) => (
                            <li key={t.id}>
                              <button
                                type="button"
                                onClick={() => void playTrack(t)}
                                className={`flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent ${t.id === currentId ? "bg-accent/50" : ""}`}
                              >
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded text-[10px] font-semibold text-white" style={t.coverBlobId ? undefined : { background: coverStyle(t.title) }}>
                                  {t.coverBlobId ? <BlobImage blobId={t.coverBlobId} className="h-full w-full object-cover" /> : initialsOf(t.title)}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                                <span className="text-[11px] text-muted-foreground">{fmtDuration(t.duration)}</span>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    queueRef.current = queueRef.current.filter((x) => x.id !== t.id);
                                    setQueueList([...queueRef.current]);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.stopPropagation();
                                      queueRef.current = queueRef.current.filter((x) => x.id !== t.id);
                                      setQueueList([...queueRef.current]);
                                    }
                                  }}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
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
            <p className="mt-1 mb-4 text-xs text-muted-foreground">
              Large files are pulled in parallel 4 MB chunks and resume where they left off.
            </p>
            <DownloadForm kind="music" urlPlaceholder="https://…/track.mp3" />
          </div>

          <div className="mt-5 space-y-2">
            <p className="microlabel mb-3">Queue</p>
            {musicDownloads.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nothing downloading.</p>}
            {musicDownloads.map((d) => (
              <div key={d.id} className="quiet-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{d.url} · {d.status}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {d.total > 0 ? fmtBytes(d.received ?? d.total * d.progress) : ""}
                      {d.total > 0 ? ` / ${fmtBytes(d.total)}` : ""}
                      {d.speed ? ` · ${fmtBytes(d.speed)}/s` : ""}
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
                    <Download className="h-3 w-3" /> Ready — added to your library.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "browse" && (
        <div className="quiet-card p-5">
          <FreeLibraryBrowser kind="music" defaultQuery="gospel" />
        </div>
      )}
    </div>
  );
}

/** Search + sort the library. */
function useFilteredTracks(all: Track[], query: string, sortBy: "recent" | "title" | "artist"): Track[] {
  const q = query.trim().toLowerCase();
  const out = q ? all.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q)) : all;
  if (sortBy === "title") return [...out].sort((a, b) => a.title.localeCompare(b.title));
  if (sortBy === "artist") return [...out].sort((a, b) => (a.artist || "").localeCompare(b.artist || ""));
  return out;
}
