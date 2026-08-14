import { ArrowLeft, FileText, Loader } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

import { useCollection, put, blobUrl, type Book } from "@/lib/db";

export default function Reader() {
  const { id } = useParams<{ id: string }>();
  const books = useCollection<Book>("books");
  const book = books.find((b) => b.id === id) ?? null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Loading…");
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [txtRatio, setTxtRatio] = useState(0);

  useEffect(() => {
    if (!book) return;
    let alive = true;
    blobUrl(book.blobId).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [book?.id, book?.blobId]);

  /* EPUB */
  useEffect(() => {
    if (!book || !url || book.kind !== "epub") return;
    let cleanup: (() => void) | null = null;
    void (async () => {
      const { default: ePub } = await import("epubjs");
      const epub = ePub(url);
      try {
        await epub.ready;
        const rendition = epub.renderTo(containerRef.current!, {
          width: "100%",
          height: "100%",
          spread: "auto",
        });
        cleanup = () => {
          try {
            rendition.destroy();
            epub.destroy();
          } catch {
            /* already gone */
          }
        };
        rendition.on("relocated", (loc: unknown) => {
          const start = (loc as { start?: { cfi?: string } })?.start?.cfi;
          if (start) void put<Book>("books", { ...book, progress: start });
        });
        await rendition.display(book.progress || undefined);
        setStatus("Reading");
      } catch {
        setStatus("Could not open this epub");
      }
    })();
    return () => cleanup?.();
  }, [book?.id, url]);

  /* PDF */
  useEffect(() => {
    if (!book || !url || book.kind !== "pdf") return;
    let cancelled = false;
    let task: { destroy: () => void } | null = null;
    void (async () => {
      try {
        const loadingTask = pdfjs.getDocument({ url });
        task = loadingTask as unknown as { destroy: () => void };
        const doc = await loadingTask.promise;
        if (cancelled) {
          return;
        }
        setPages(doc.numPages);
        const startPage = Math.min(Math.max(Number(book.progress || 1), 1), doc.numPages);
        setPage(startPage);
        const renderPage = async (n: number) => {
          if (cancelled || !containerRef.current) return;
          const p = await doc.getPage(n);
          const base = p.getViewport({ scale: 1 });
          const width = containerRef.current.clientWidth || 600;
          const scale = width / base.width;
          const viewport = p.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "w-full rounded-md border bg-card";
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          await p.render({ canvasContext: ctx, viewport, canvas } as never).promise;
          if (!cancelled && containerRef.current) {
            containerRef.current.replaceChildren(canvas);
            setStatus(`Page ${n} of ${doc.numPages}`);
          }
        };
        await renderPage(startPage);
      } catch {
        setStatus("Could not open this PDF");
      }
    })();
    return () => {
      cancelled = true;
      task?.destroy();
    };
  }, [book?.id, url]);

  useEffect(() => {
    if (!book || book.kind !== "pdf" || page < 1) return;
    void put<Book>("books", { ...book, progress: String(page) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  /* TXT */
  useEffect(() => {
    if (!book || !url || book.kind !== "txt") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(url);
        const text = await res.text();
        if (cancelled || !containerRef.current) return;
        const pre = document.createElement("pre");
        pre.className =
          "whitespace-pre-wrap font-sans text-[15px] leading-relaxed outline-none";
        pre.textContent = text;
        pre.style.padding = "1rem";
        containerRef.current.replaceChildren(pre);
        const ratio = Math.min(Number(book.progress || 0), 1);
        containerRef.current.scrollTop = ratio * containerRef.current.scrollHeight;
        setStatus(`${text.length.toLocaleString()} chars`);
        containerRef.current.onscroll = () => {
          const el = containerRef.current;
          if (!el) return;
          const r = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0;
          setTxtRatio(Math.max(0, Math.min(1, r)));
        };
      } catch {
        setStatus("Could not open this text file");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [book?.id, url]);

  useEffect(() => {
    if (!book || book.kind !== "txt" || txtRatio === 0) return;
    void put<Book>("books", { ...book, progress: String(txtRatio) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txtRatio]);

  if (!book) {
    return (
      <div className="flex flex-col items-center py-20 text-center">
        <p className="text-sm text-muted-foreground">Book not found.</p>
        <Link to="/app/books" className="mt-3 text-sm underline">
          Back to library
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/app/books"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <p className="microlabel">{book.kind.toUpperCase()}</p>
            <h1 className="text-lg font-semibold tracking-tight">{book.title}</h1>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{status}</p>
      </div>

      {book.kind === "pdf" && (
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40"
          >
            Previous
          </button>
          <input
            type="range"
            min={1}
            max={pages}
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
            className="flex-1"
          />
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className={`min-h-0 flex-1 overflow-auto rounded-md border bg-card ${
          book.kind === "epub" ? "p-6" : ""
        }`}
      >
        {!url && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader className="h-5 w-5 animate-spin" />
            <span className="text-xs">{status}</span>
          </div>
        )}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <FileText className="h-3 w-3" /> Progress saves automatically
      </p>
    </div>
  );
}
