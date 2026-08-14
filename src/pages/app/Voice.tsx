import { Mic, Pause, Play, Square, Trash2, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import { useCollection, put, remove, deleteBlob, saveBlob, type VoiceNote } from "@/lib/db";
import { fmtDuration, relativeTime, uid } from "@/lib/format";

export default function Voice() {
  const notes = useCollection<VoiceNote>("voice");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const sorted = [...notes].sort((a, b) => b.createdAt - a.createdAt);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast("Recording is not available in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        const blobId = await saveBlob(blob, blob.type);
        const audio = new Audio();
        audio.src = URL.createObjectURL(blob);
        const duration = await new Promise<number>((resolve) => {
          audio.onloadedmetadata = () => resolve(audio.duration || 0);
          audio.onerror = () => resolve(0);
        });
        URL.revokeObjectURL(audio.src);
        await put<VoiceNote>("voice", {
          id: uid(),
          blobId,
          title: `Voice memo — ${new Date().toLocaleDateString([], { month: "short", day: "numeric" })}`,
          duration,
          createdAt: Date.now(),
        });
        setRecording(false);
        setElapsed(0);
        toast("Voice memo saved");
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      toast("Microphone permission denied");
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const togglePlay = async (n: VoiceNote) => {
    if (playingId === n.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    const { blobUrl } = await import("@/lib/db");
    const url = await blobUrl(n.blobId);
    if (!url) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => setPlayingId(null);
    audio.onpause = () => {
      if (audioRef.current === audio) setPlayingId(null);
    };
    audio.play();
    setPlayingId(n.id);
  };

  const rename = (n: VoiceNote, title: string) => {
    void put<VoiceNote>("voice", { ...n, title });
  };

  const removeNote = async (n: VoiceNote) => {
    if (playingId === n.id) {
      audioRef.current?.pause();
      setPlayingId(null);
    }
    await deleteBlob(n.blobId);
    await remove("voice", n.id);
    toast("Memo deleted");
  };

  return (
    <div>
      <PageHeader
        eyebrow="Capture"
        title="Voice"
        description="Record thoughts out loud. Audio is encoded and stored on this device."
      />

      <div className="quiet-card flex flex-col items-center p-8 text-center">
        <div
          className={`flex h-20 w-20 items-center justify-center rounded-full transition-colors ${
            recording ? "bg-destructive/10" : "bg-foreground"
          }`}
        >
          {recording ? (
            <span className="h-6 w-6 animate-pulse rounded-full bg-destructive" />
          ) : (
            <Mic className="h-8 w-8 text-background" />
          )}
        </div>
        <p className="mt-4 font-mono text-lg tabular-nums">
          {recording ? fmtDuration(elapsed) : "Ready"}
        </p>
        <div className="mt-4 flex gap-2">
          {!recording ? (
            <button
              type="button"
              onClick={() => void start()}
              className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              <Mic className="h-4 w-4" /> Start recording
            </button>
          ) : (
            <button
              type="button"
              onClick={stop}
              className="inline-flex items-center gap-2 rounded-md bg-destructive px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              <Square className="h-4 w-4" /> Stop
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-2">
        <p className="microlabel mb-3">Memos · {sorted.length}</p>
        {sorted.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No voice memos yet.</p>
        )}
        {sorted.map((n) => (
          <div key={n.id} className="quiet-card flex items-center gap-3 p-3">
            <button
              type="button"
              onClick={() => void togglePlay(n)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-foreground text-background transition-opacity hover:opacity-90"
            >
              {playingId === n.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <div className="min-w-0 flex-1">
              <input
                value={n.title}
                onChange={(e) => rename(n, e.target.value)}
                className="w-full truncate bg-transparent text-sm font-medium outline-none"
              />
              <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <Volume2 className="h-3 w-3" /> {fmtDuration(n.duration)} · {relativeTime(n.createdAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void removeNote(n)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
