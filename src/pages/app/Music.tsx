import {
  Download,
  SlidersHorizontal,
  ListMusic,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Timer,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import { useCollection, put, remove, deleteBlob, saveBlob, blobUrl, type Track, type DownloadTask, type Playlist } from "@/lib/db";
import { fmtBytes, fmtDuration, filenameFromUrl, relativeTime, uid } from "@/lib/format";
import { cancelDownload, deleteDownload, isDownloadActive, startDownload } from "@/lib/downloader";
import { notify } from "@/lib/notifications";

const EQ_BANDS = [
  { key: "low", label: "Bass", freq: 200 },
  { key: "mid", label: "Mid", freq: 1000 },
  { key: "high", label: "Treble", freq: 3500 },
] as const;

export default function Music() {
  const tracks = useCollection<Track>("music");
  const downloads = useCollection<DownloadTask>("downloads");
  const playlists = useCollection<Playlist>("playlists");
  const [tab, setTab] = useState<"library" | "downloads">("library");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off");
  const [speed, setSpeed] = useState(1);
  const [sleepMin, setSleepMin] = useState<number | null>(null);
  const [eqOn, setEqOn] = useState(false);
  const [eqPanel, setEqPanel] = useState(false);
  const [eq, setEq] = useState({ low: 0, mid: 0, high: 0 });
  const [newPlaylist, setNewPlaylist] = useState("");
  const [addTo, setAddTo] = useState<Track | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const queueRef = useRef<Track[]>([]);
  const sleepTimerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const eqGraphRef = useRef<{ source: MediaElementAudioSourceNode; gains: BiquadFilterNode[] } | null>(null);

  const sorted = [...tracks].sort((a, b) => b.createdAt - a.createdAt);
  const musicDownloads = downloads.filter((d) => d.kind === "music").sort((a, b) => b.createdAt - a.createdAt);
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

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (sleepTimerRef.current) window.clearTimeout(sleepTimerRef.current);
      if (eqGraphRef.current) {
        try {
          eqGraphRef.current.source.disconnect();
        } catch {
          /* already gone */
        }
      }
      if (audioCtxRef.current) void audioCtxRef.current.close().catch(() => undefined);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const applyEq = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!eqOn) {
      if (eqGraphRef.current) {
        try {
          eqGraphRef.current.source.disconnect();
        } catch {
          /* noop */
        }
        eqGraphRef.current = null;
      }
      return;
    }
    if (eqGraphRef.current) {
      eqGraphRef.current.gains.forEach((g, i) => (g.gain.value = [eq.low, eq.mid, eq.high][i]));
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = audioCtxRef.current ?? new Ctor();
    audioCtxRef.current = ctx;
    await ctx.resume().catch(() => undefined);
    const source = ctx.createMediaElementSource(audio);
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
    gains.forEach((g, i) => (g.gain.value = [eq.low, eq.mid, eq.high][i]));
    eqGraphRef.current = { source, gains };
  };

  useEffect(() => {
    void applyEq();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eqOn, eq.low, eq.mid, eq.high]);

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
    if (queue) queueRef.current = queue;
    if (currentId === t.id) {
      if (audioRef.current) {
        if (playing) audioRef.current.pause();
        else void audioRef.current.play();
      }
      return;
    }
    audioRef.current?.pause();
    if (eqGraphRef.current) {
      try {
        eqGraphRef.current.source.disconnect();
      } catch {
        /* noop */
      }
      eqGraphRef.current = null;
    }
    const u = await blobUrl(t.blobId);
    if (!u) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = u;
    const audio = new Audio(u);
    audioRef.current = audio;
    audio.playbackRate = speed;
    audio.ontimeupdate = () => setTime(audio.currentTime);
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
    await audio.play();
    setPlaying(true);
    if (eqOn) void applyEq();
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
        notify("Sleep timer", "Playback paused for the night.");
      }, m * 60_000);
    }
  };

  const changeSpeed = (s: number) => {
    setSpeed(s);
    if (audioRef.current) audioRef.current.playbackRate = s;
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

  return (
    <div>
      <PageHeader
        eyebrow="Media"
        title="Music"
        description="Your library lives on this device — playlists, equalizer, sleep timer, and accelerated downloads."
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
                  className={`group relative flex items-center gap-3 rounded-md border p-3 transition-colors ${
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
                    onClick={() => setAddTo(addTo?.id === t.id ? null : t)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-accent group-hover:opacity-100"
                    title="Add to playlist"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  {addTo?.id === t.id && (
                    <div className="absolute top-full right-0 z-10 mt-1 w-48 rounded-md border bg-card p-1 shadow-md">
                      {playlists.length === 0 && (
                        <p className="px-2 py-1.5 text-xs text-muted-foreground">No playlists yet</p>
                      )}
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
                  <button
                    type="button"
                    onClick={() => setShuffle((s) => !s)}
                    className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                      shuffle ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent"
                    }`}
                    title="Shuffle"
                  >
                    <Shuffle className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRepeatMode((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"))}
                    className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                      repeatMode !== "off" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent"
                    }`}
                    title={repeatMode === "one" ? "Repeat one" : repeatMode === "all" ? "Repeat all" : "Repeat off"}
                  >
                    {repeatMode === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={prev} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
                    <SkipBack className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={togglePlay} className="flex h-10 w-10 items-center justify-center rounded-md bg-foreground text-background hover:opacity-90">
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={next} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
                    <SkipForward className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSleepMin((s) => (s === null ? 15 : null))}
                    className={`relative flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                      sleepMin ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent"
                    }`}
                    title="Sleep timer"
                  >
                    <Timer className="h-4 w-4" />
                    {sleepMin && <span className="absolute -top-1.5 -right-1.5 rounded-full bg-foreground px-1 text-[9px] text-background">{sleepMin}m</span>}
                  </button>
                  <select
                    value={speed}
                    onChange={(e) => changeSpeed(Number(e.target.value))}
                    className="rounded-md border bg-transparent px-1.5 py-1.5 text-xs outline-none focus:border-foreground/40"
                    title="Playback speed"
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                      <option key={s} value={s}>{s}×</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setEqOn((v) => !v)}
                    className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                      eqOn ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent"
                    }`}
                    title="Equalizer"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEqPanel((v) => !v)}
                    className={`flex h-8 items-center justify-center rounded-md px-2 text-xs transition-colors ${eqPanel ? "bg-accent" : "text-muted-foreground hover:bg-accent"}`}
                  >
                    EQ
                  </button>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span className="w-12 text-right font-mono text-xs text-muted-foreground tabular-nums">{fmtDuration(time)}</span>
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
                <span className="w-12 font-mono text-xs text-muted-foreground tabular-nums">{fmtDuration(current.duration)}</span>
              </div>
              {eqPanel && eqOn && (
                <div className="mt-3 flex items-center gap-5 border-t pt-3">
                  {EQ_BANDS.map((band) => (
                    <label key={band.key} className="flex flex-1 flex-col items-center gap-1 text-[10px] text-muted-foreground">
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
                  {sleepMin && (
                    <span className="text-[10px] text-muted-foreground">Sleep in {sleepMin}m</span>
                  )}
                </div>
              )}
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
                  void startDownload({ url: url.trim(), kind: "music", title: title.trim() || filenameFromUrl(url) });
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
                      {d.total > 0 ? fmtBytes(d.total * d.progress) : ""}
                      {d.total > 0 ? ` / ${fmtBytes(d.total)}` : ""}
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
