import { BookOpen, Download, FileText, Library, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import { useCollection, put, remove, deleteBlob, saveBlob, type Book, type DownloadTask } from "@/lib/db";
import { fmtBytes, filenameFromUrl, initialsOf, relativeTime, uid } from "@/lib/format";
import { cancelDownload, deleteDownload, isDownloadActive, startDownload } from "@/lib/downloader";

const KIND_BY_EXT: Record<string, Book["kind"]> = {
  epub: "epub",
  pdf: "pdf",
  txt: "txt",
};

export default function Books() {
  const books = useCollection<Book>("books");
  const downloads = useCollection<DownloadTask>("downloads");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  const sorted = [...books].sort((a, b) => b.createdAt - a.createdAt);
  const bookDownloads = downloads.filter((d) => d.kind === "book").sort((a, b) => b.createdAt - a.createdAt);

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

  return (
    <div>
      <PageHeader
        eyebrow="Media"
        title="Books"
        description="Read epub, PDF and plain text — imported or downloaded, all stored on this device."
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
            <Link
              to="/app/books"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              <BookOpen className="h-4 w-4" /> Library
            </Link>
          </>
        }
      />

      {sorted.length === 0 ? (
        <div className="quiet-card flex flex-col items-center p-12 text-center">
          <Library className="h-6 w-6 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">Your library is empty. Import an .epub, .pdf or .txt file.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((b) => (
            <Link
              key={b.id}
              to={`/app/books/${b.id}`}
              className="group rounded-md border p-3 transition-colors hover:bg-accent/30"
            >
              <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-sm bg-muted/70">
                <span className="text-3xl font-semibold tracking-tight text-muted-foreground/60">
                  {initialsOf(b.title)}
                </span>
                <span className="absolute top-2 right-2 rounded-sm border bg-card/80 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                  {b.kind}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    void removeBook(b);
                  }}
                  className="absolute right-2 bottom-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-2 truncate text-sm font-medium">{b.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {b.author || "Unknown author"} · {progressLabel(b)}
              </p>
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
          <div className="flex flex-wrap gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/book.epub"
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
                void startDownload({ url: url.trim(), kind: "book", title: title.trim() || filenameFromUrl(url) });
                setUrl("");
                setTitle("");
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> Start
            </button>
          </div>
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
    </div>
  );
}
