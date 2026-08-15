import { BookOpen, Download, Library, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import DownloadForm from "@/components/app/DownloadForm";
import FreeLibraryBrowser from "@/components/app/FreeLibraryBrowser";
import PageHeader from "@/components/app/PageHeader";
import { BOOK_GENRES } from "@/lib/freelibrary";
import { useCollection, put, remove, deleteBlob, saveBlob, type Book, type DownloadTask } from "@/lib/db";
import { fmtBytes, initialsOf, uid } from "@/lib/format";
import { cancelDownload, deleteDownload, isDownloadActive } from "@/lib/downloader";

const KIND_BY_EXT: Record<string, Book["kind"]> = {
  epub: "epub",
  pdf: "pdf",
  txt: "txt",
};

/** A warm, deterministic cover gradient so every book looks hand-bound. */
function bookCoverStyle(title: string): string {
  const hue = [...title].reduce((a, c) => a + c.charCodeAt(0), 0);
  const c1 = `oklch(${0.52 + (hue % 18) / 100} ${0.06 + (hue % 4) / 100} ${(hue * 47) % 360})`;
  const c2 = `oklch(${0.3 + (hue % 14) / 100} ${0.07 + (hue % 3) / 100} ${(hue * 61 + 60) % 360})`;
  return `linear-gradient(155deg, ${c1}, ${c2})`;
}

export default function Books() {
  const books = useCollection<Book>("books");
  const downloads = useCollection<DownloadTask>("downloads");
  const [view, setView] = useState<"library" | "browse">("library");

  const sorted = [...books].sort((a, b) => b.createdAt - a.createdAt);
  const bookDownloads = downloads.filter((d) => d.kind === "book").sort((a, b) => b.createdAt - a.createdAt);
  const reading = sorted.filter((b) => !!b.progress);
  const toRead = sorted.filter((b) => !b.progress);

  useEffect(() => {
    bookDownloads.forEach((task) => {
      if (task.status === "done" && task.blobId && !books.some((b) => b.blobId === task.blobId)) {
        const ext = task.url.split(".").pop()?.toLowerCase() ?? "";
        void put<Book>("books", {
          id: uid(),
          title: task.title,
          author: "",
          kind: KIND_BY_EXT[ext] ?? "txt",
          blobId: task.blobId!,
          progress: "",
          createdAt: Date.now(),
        });
      }
    });
  }, [bookDownloads, books]);

  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    let added = 0;
    for (const f of Array.from(files)) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      const kind = KIND_BY_EXT[ext];
      if (!kind) continue;
      const blobId = await saveBlob(f, f.type);
      const base = f.name.replace(/\.[a-z0-9]+$/i, "");
      const parts = base.split(/\s*[-–—]\s*/);
      await put<Book>("books", {
        id: uid(),
        title: parts.length > 1 ? parts[1].trim() : base,
        author: parts.length > 1 ? parts[0].trim() : "",
        kind,
        blobId,
        progress: "",
        createdAt: Date.now(),
      });
      added++;
    }
    if (added > 0) toast(`${added} book${added > 1 ? "s" : ""} imported`);
  };

  const removeBook = async (b: Book) => {
    await deleteBlob(b.blobId);
    await remove("books", b.id);
    toast("Book removed");
  };

  const progressLabel = (b: Book): string => {
    if (!b.progress) return "Not started";
    if (b.kind === "pdf") return `Page ${b.progress}`;
    if (b.kind === "txt") return `${Math.round(Number(b.progress) * 100)}%`;
    return "In progress";
  };

  const progressPct = (b: Book): string => {
    if (!b.progress) return "0%";
    if (b.kind === "txt") return `${Math.min(100, Math.round(Number(b.progress) * 100))}%`;
    return "45%"; // pdf page / epub cfi — exact fraction unknown
  };

  return (
    <div>
      <PageHeader
        eyebrow="Media"
        title="Books"
        description="Your personal library — imported or downloaded, all stored on this device."
        actions={
          <>
            <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm transition-colors hover:bg-accent">
              <Upload className="h-3.5 w-3.5" /> Import
              <input
                type="file"
                accept=".epub,.pdf,.txt"
                multiple
                className="hidden"
                onChange={(e) => {
                  void importFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => setView("library")}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${view === "library" ? "bg-foreground text-background" : "border hover:bg-accent"}`}
            >
              <BookOpen className="h-4 w-4" /> My library
            </button>
            <button
              type="button"
              onClick={() => setView("browse")}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${view === "browse" ? "bg-foreground text-background" : "border hover:bg-accent"}`}
            >
              <Search className="h-4 w-4" /> Free library
            </button>
          </>
        }
      />

      {view === "browse" ? (
        <FreeLibraryBrowser kind="book" genres={BOOK_GENRES} />
      ) : (
        <>
          {/* Library stats */}
          <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          { value: sorted.length, label: "In library" },
          { value: reading.length, label: "Reading" },
          { value: toRead.length, label: "To read" },
        ].map((s) => (
          <div key={s.label} className="quiet-card p-4 text-center">
            <p className="text-2xl font-semibold tracking-tight tabular-nums">{s.value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Currently reading */}
      {reading.length > 0 && (
        <Link
          to={`/app/books/${reading[0].id}`}
          className="group mb-8 flex items-center gap-5 overflow-hidden rounded-xl border bg-gradient-to-br from-accent/60 to-transparent p-5"
        >
          <div
            className="flex h-24 w-16 shrink-0 items-center justify-center rounded-md shadow-lg"
            style={{ background: bookCoverStyle(reading[0].title) }}
          >
            <span className="text-xs font-semibold text-white/90">{initialsOf(reading[0].title)}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="microlabel">Currently reading</p>
            <p className="mt-1 truncate text-lg font-semibold tracking-tight">{reading[0].title}</p>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {reading[0].author || "Unknown author"} · {progressLabel(reading[0])}
            </p>
            <p className="mt-2 text-xs font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
              Continue reading →
            </p>
          </div>
        </Link>
      )}

      {/* Shelf */}
      {sorted.length === 0 ? (
        <div className="quiet-card flex flex-col items-center p-14 text-center">
          <Library className="h-8 w-8 text-muted-foreground/40" />
          <p className="mt-4 text-sm font-medium">Your shelf is empty</p>
          <p className="mt-1 text-xs text-muted-foreground">Import an .epub, .pdf or .txt — or paste a direct link below.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((b) => (
            <Link key={b.id} to={`/app/books/${b.id}`} className="group relative">
              <div
                className="relative aspect-[3/4] overflow-hidden rounded-md shadow-md transition-all duration-200 group-hover:-translate-y-1.5 group-hover:shadow-xl"
                style={{ background: bookCoverStyle(b.title) }}
              >
                {/* Spine */}
                <div className="absolute inset-y-0 left-0 w-2 bg-black/30" />
                <div className="absolute inset-y-0 left-2 w-px bg-white/10" />

                {/* Cover content */}
                <div className="relative flex h-full flex-col justify-between p-4 pl-7">
                  <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/60">{b.kind}</span>
                  <div>
                    <p className="text-[15px] font-semibold leading-snug text-white drop-shadow-sm">{b.title}</p>
                    <p className="mt-1 text-[11px] text-white/65">{b.author || "Unknown author"}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] text-white/70">{progressLabel(b)}</p>
                    <div className="h-1 overflow-hidden rounded-full bg-black/25">
                      <div className="h-full bg-white/80" style={{ width: progressPct(b) }} />
                    </div>
                  </div>
                </div>

                {/* Delete */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    void removeBook(b);
                  }}
                  className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/70 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Downloads */}
      <div className="mt-10">
        <div className="quiet-card p-5">
          <p className="microlabel">Download a book</p>
          <p className="mt-1 mb-4 text-xs text-muted-foreground">
            Accelerated, resumable download. Paste a direct link to an .epub, .pdf or .txt file.
          </p>
          <DownloadForm kind="book" urlPlaceholder="https://…/book.epub" />
        </div>

        {bookDownloads.length > 0 && (
          <div className="mt-4 space-y-2">
            {bookDownloads.map((d) => (
              <div key={d.id} className="quiet-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{d.status}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {d.total > 0 ? `${fmtBytes(d.received ?? d.total * d.progress)} / ${fmtBytes(d.total)}` : ""}
                      {d.speed ? ` · ${fmtBytes(d.speed)}/s` : ""}
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
                {d.status === "done" && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Download className="h-3 w-3" /> Ready — added to your library.
                  </p>
                )}
                {d.status === "error" && d.error && <p className="mt-2 text-xs text-destructive">{d.error}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
