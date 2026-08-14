import { CalendarDays, FileText, Save, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import BlobImage from "@/components/BlobImage";
import { useCollection, put, remove, deleteBlob, saveBlob, type DiaryEntry } from "@/lib/db";
import { fmtFullDate, todayKey, uid } from "@/lib/format";

const MOODS = [
  { emoji: "😌", label: "Calm" },
  { emoji: "😊", label: "Happy" },
  { emoji: "🤔", label: "Thoughtful" },
  { emoji: "😐", label: "Neutral" },
  { emoji: "😮‍💨", label: "Tired" },
  { emoji: "😞", label: "Low" },
];

export default function Diary() {
  const entries = useCollection<DiaryEntry>("diary");
  const [date, setDate] = useState(() => todayKey());
  const [mood, setMood] = useState("😌");
  const [content, setContent] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const loadedFor = useRef<string>("");

  const existing = entries.find((e) => e.date === date);

  // Load the entry for the chosen day once per date.
  const loadDay = (d: string) => {
    const e = entries.find((x) => x.date === d);
    if (loadedFor.current === d) return;
    loadedFor.current = d;
    if (e) {
      setMood(e.mood);
      setContent(e.content);
      setPhotos(e.photos);
    } else {
      setMood("😌");
      setContent("");
      setPhotos([]);
    }
  };

  const pickDate = (d: string) => {
    setDate(d);
    loadDay(d);
  };

  const save = async () => {
    const id = existing?.id ?? uid();
    await put<DiaryEntry>("diary", {
      id,
      date,
      mood,
      content,
      photos,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    toast("Saved to journal");
  };

  const attach = async (files: FileList | null) => {
    if (!files) return;
    const ids: string[] = [];
    for (const f of Array.from(files).slice(0, 6)) ids.push(await saveBlob(f, f.type));
    setPhotos((p) => [...p, ...ids]);
  };

  const removePhoto = (blobId: string) => {
    setPhotos((p) => p.filter((x) => x !== blobId));
    void deleteBlob(blobId);
  };

  const removeEntry = async () => {
    if (!existing) return;
    for (const p of existing.photos) await deleteBlob(p);
    await remove("diary", existing.id);
    loadedFor.current = "";
    setContent("");
    setPhotos([]);
    setMood("😌");
    toast("Entry removed");
  };

  const months = useMemo(() => {
    const map = new Map<string, DiaryEntry[]>();
    [...entries]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .forEach((e) => {
        const key = e.date.slice(0, 7);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(e);
      });
    return [...map.entries()];
  }, [entries]);

  return (
    <div>
      <PageHeader
        eyebrow="Capture"
        title="Diary"
        description="One quiet page per day — how you felt, what happened, what you want to keep."
        actions={
          <>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <input
                type="date"
                value={date}
                onChange={(e) => pickDate(e.target.value)}
                className="rounded-md border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-foreground/40"
              />
            </div>
            <button
              type="button"
              onClick={() => save()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              <Save className="h-4 w-4" /> Save
            </button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="quiet-card p-5">
          <p className="microlabel">{fmtFullDate(date)}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {MOODS.map((m) => (
              <button
                key={m.label}
                type="button"
                onClick={() => setMood(m.emoji)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  mood === m.emoji ? "border-foreground/60 bg-accent" : "hover:bg-accent/50"
                }`}
              >
                <span className="mr-1.5">{m.emoji}</span>
                {m.label}
              </button>
            ))}
          </div>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What did today hold? How did it feel?"
            rows={12}
            className="mt-4 w-full resize-y bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
          />

          {photos.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.map((p) => (
                <div key={p} className="group relative overflow-hidden rounded-md border">
                  <BlobImage blobId={p} className="aspect-square w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(p)}
                    className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between border-t pt-4">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
              <FileText className="h-3.5 w-3.5" /> Add photo
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void attach(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {existing && (
              <button
                type="button"
                onClick={() => removeEntry()}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete entry
              </button>
            )}
          </div>
        </div>

        {/* History */}
        <div>
          <p className="microlabel mb-3">History</p>
          <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
            {months.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No entries yet.</p>
            )}
            {months.map(([month, list]) => (
              <div key={month}>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  {new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleDateString([], {
                    month: "long",
                    year: "numeric",
                  })}
                </p>
                <div className="space-y-2">
                  {list.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => pickDate(e.date)}
                      className={`w-full rounded-md border p-3 text-left transition-colors ${
                        date === e.date ? "border-foreground/50 bg-accent/40" : "hover:bg-accent/40"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">{fmtFullDate(e.date)}</p>
                        <span className="text-sm">{e.mood}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {e.content || "—"}
                      </p>
                      {e.photos.length > 0 && (
                        <p className="mt-1 text-[11px] text-muted-foreground/70">{e.photos.length} photos</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
