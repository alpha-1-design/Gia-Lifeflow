import { FileText, Pin, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import BlobImage from "@/components/BlobImage";
import { useCollection, put, remove, deleteBlob, saveBlob, type Note } from "@/lib/db";
import { relativeTime, uid } from "@/lib/format";

interface Draft {
  id: string;
  title: string;
  content: string;
  tags: string;
  photos: string[];
  pinned: boolean;
}

export default function Notes() {
  const notes = useCollection<Note>("notes");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const draftRef = useRef<Draft | null>(null);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  // Select the newest note when the list first loads.
  useEffect(() => {
    if (!selectedId && notes.length > 0) {
      const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
      setSelectedId(sorted[0].id);
    }
  }, [notes, selectedId]);

  const flush = () => {
    const d = draftRef.current;
    if (!d) return;
    void put<Note>("notes", {
      id: d.id,
      title: d.title.trim(),
      content: d.content,
      photos: d.photos,
      tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean),
      pinned: d.pinned,
      createdAt: selected?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
  };

  // Debounced autosave; flushes on switch/unmount.
  useEffect(() => {
    if (!draftRef.current) return;
    const t = setTimeout(flush, 500);
    return () => {
      clearTimeout(t);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftRef.current?.title, draftRef.current?.content, draftRef.current?.tags, draftRef.current?.photos, draftRef.current?.pinned]);

  const createNote = () => {
    flush();
    const id = uid();
    draftRef.current = {
      id,
      title: "",
      content: "",
      tags: "",
      photos: [],
      pinned: false,
    };
    void put<Note>("notes", {
      id,
      title: "",
      content: "",
      photos: [],
      tags: [],
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setSelectedId(id);
  };

  const selectNote = (id: string) => {
    flush();
    setSelectedId(id);
  };

  const attachPhotos = async (files: FileList | null) => {
    if (!files || !draftRef.current) return;
    const ids: string[] = [];
    for (const f of Array.from(files).slice(0, 6)) {
      ids.push(await saveBlob(f, f.type));
    }
    if (draftRef.current) draftRef.current.photos = [...draftRef.current.photos, ...ids];
    setSelectedId((id) => id);
    void put<Note>("notes", {
      ...(draftRef.current as unknown as Note),
      photos: draftRef.current.photos,
      updatedAt: Date.now(),
    });
  };

  const removePhoto = (blobId: string) => {
    if (!draftRef.current) return;
    draftRef.current.photos = draftRef.current.photos.filter((p) => p !== blobId);
    void deleteBlob(blobId);
    setSelectedId((id) => id);
  };

  const deleteNote = async (id: string) => {
    const note = notes.find((n) => n.id === id);
    if (note) {
      for (const p of note.photos) await deleteBlob(p);
    }
    await remove("notes", id);
    if (selectedId === id) {
      draftRef.current = null;
      setSelectedId(null);
    }
    toast("Note deleted");
  };

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return [...notes]
      .filter((n) => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [notes, query]);

  const draft: Draft = selected
    ? {
        id: selected.id,
        title: draftRef.current?.id === selected.id ? draftRef.current.title : selected.title,
        content: draftRef.current?.id === selected.id ? draftRef.current.content : selected.content,
        tags: draftRef.current?.id === selected.id ? draftRef.current.tags : selected.tags.join(", "),
        photos: draftRef.current?.id === selected.id ? draftRef.current.photos : selected.photos,
        pinned: draftRef.current?.id === selected.id ? draftRef.current.pinned : selected.pinned,
      }
    : { id: "", title: "", content: "", tags: "", photos: [], pinned: false };
  draftRef.current = draft.id ? draft : draftRef.current;

  return (
    <div>
      <PageHeader
        eyebrow="Capture"
        title="Notes"
        description="Thoughts, lists, anything. Stored on this device only."
        actions={
          <>
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="h-9 w-40 rounded-md border bg-transparent pr-3 pl-8 text-sm outline-none focus:border-foreground/40"
              />
            </div>
            <button
              type="button"
              onClick={createNote}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> New note
            </button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* List */}
        <div className="space-y-1.5">
          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {query ? "No notes match." : "No notes yet — create your first."}
            </p>
          )}
          {filtered.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => selectNote(n.id)}
              className={`w-full rounded-md border p-3 text-left transition-colors ${
                selectedId === n.id ? "border-foreground/50 bg-accent/40" : "hover:bg-accent/40"
              }`}
            >
              <div className="flex items-center gap-2">
                {n.pinned && <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />}
                <p className="truncate text-sm font-medium">{n.title || "Untitled"}</p>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{n.content || "—"}</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                {relativeTime(n.updatedAt)} · {n.photos.length} photo{n.photos.length === 1 ? "" : "s"}
              </p>
            </button>
          ))}
        </div>

        {/* Editor */}
        {selected ? (
          <div className="quiet-card p-5">
            <div className="flex items-center justify-between gap-2">
              <input
                value={draft.title}
                onChange={(e) => {
                  if (draftRef.current) draftRef.current.title = e.target.value;
                  setSelectedId((id) => id);
                }}
                placeholder="Title"
                className="flex-1 bg-transparent text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    if (draftRef.current) draftRef.current.pinned = !draftRef.current.pinned;
                    setSelectedId((id) => id);
                  }}
                  title="Pin"
                  className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent ${
                    draft.pinned ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Pin className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteNote(selected.id)}
                  title="Delete"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <textarea
              value={draft.content}
              onChange={(e) => {
                if (draftRef.current) draftRef.current.content = e.target.value;
                setSelectedId((id) => id);
              }}
              placeholder="Start writing…"
              rows={14}
              className="mt-3 w-full resize-y bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
            />

            {draft.photos.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {draft.photos.map((p) => (
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

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t pt-4">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
                <FileText className="h-3.5 w-3.5" />
                Attach photo
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void attachPhotos(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <input
                value={draft.tags}
                onChange={(e) => {
                  if (draftRef.current) draftRef.current.tags = e.target.value;
                  setSelectedId((id) => id);
                }}
                placeholder="tags, comma, separated"
                className="flex-1 rounded-md border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-foreground/40"
              />
            </div>
          </div>
        ) : (
          <div className="quiet-card flex flex-col items-center justify-center p-10 text-center">
            <FileText className="h-6 w-6 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">Select a note or create a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
}
