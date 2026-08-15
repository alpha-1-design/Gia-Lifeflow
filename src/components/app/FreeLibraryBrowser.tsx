import { BookOpen, Download, ExternalLink, Loader, Music2, Play, Search, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { startDownload } from "@/lib/downloader";
import { fetchText, searchBooks, searchMedia, type FreeItem, type FreeKind } from "@/lib/freelibrary";

interface FreeLibraryBrowserProps {
  kind: FreeKind;
  defaultQuery?: string;
  genres?: { label: string; value: string }[];
}

/**
 * Browse a free, public-domain library (Gutenberg for books, Internet Archive
 * for music/films). One tap downloads straight into the queue; another reads
 * or plays it in place without downloading.
 */
export default function FreeLibraryBrowser({ kind, defaultQuery = "", genres }: FreeLibraryBrowserProps) {
  const [query, setQuery] = useState(defaultQuery);
  const [genre, setGenre] = useState("");
  const [items, setItems] = useState<FreeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [streaming, setStreaming] = useState<FreeItem | null>(null);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);

  const runSearch = async () => {
    setLoading(true);
    setError(null);
    setStreaming(null);
    try {
      const found = kind === "book" ? await searchBooks(query, genre) : await searchMedia(kind, query);
      setItems(found);
      if (found.length === 0) toast("No results — try a different search");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const download = (item: FreeItem) => {
    void startDownload({
      url: item.downloadUrl,
      kind: item.kind,
      title: item.title,
      useRelay: item.kind === "book",
    });
    toast(`Downloading ${item.title}`);
  };

  const open = async (item: FreeItem) => {
    setStreaming(item);
    setStreamText(null);
    if (item.kind === "book") {
      setStreamLoading(true);
      try {
        setStreamText(await fetchText(item.streamUrl));
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not load the book");
        setStreaming(null);
      } finally {
        setStreamLoading(false);
      }
    }
  };

  const closeStream = () => {
    setStreaming(null);
    setStreamText(null);
    setStreamLoading(false);
  };

  return (
    <div>
      {/* Search bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2.5 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
            }}
            placeholder={kind === "book" ? "Title or author…" : "Search…"}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        {genres && (
          <select
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className="rounded-md border bg-transparent px-2 py-2 text-sm outline-none focus:border-foreground/40"
          >
            {genres.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loading ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Search
        </button>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {kind === "book"
          ? "Public-domain books from Project Gutenberg. Download the epub, or read the text right here."
          : kind === "music"
            ? "Public-domain and Creative-Commons audio from the Internet Archive. Stream it, or keep a copy."
            : "Public-domain and Creative-Commons films from the Internet Archive. Stream it, or keep a copy."}
      </p>

      {error && <p className="mt-3 rounded-md border border-destructive/30 p-3 text-xs text-destructive">{error}</p>}

      {/* Results */}
      {items.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.id} className="group flex flex-col overflow-hidden rounded-lg border bg-card transition-all hover:shadow-md">
              <div className="relative aspect-[4/3] overflow-hidden bg-accent/40">
                {item.coverUrl ? (
                  <img
                    src={item.coverUrl}
                    alt={item.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : null}
                <span className="absolute top-2 left-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white backdrop-blur-sm">
                  {item.kind}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-3">
                <p className="line-clamp-2 text-sm font-medium leading-snug">{item.title}</p>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                  {item.creator || "Unknown"}
                  {item.detail ? ` · ${item.detail}` : ""}
                </p>
                <div className="mt-3 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => download(item)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-foreground px-2 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </button>
                  <button
                    type="button"
                    onClick={() => void open(item)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors hover:bg-accent"
                  >
                    {kind === "book" ? <BookOpen className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {kind === "book" ? "Read" : "Play"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stream / read overlay */}
      {streaming && (
        <div className="fixed inset-0 z-40 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{streaming.title}</p>
              <p className="truncate text-xs text-muted-foreground">{streaming.creator || "Unknown"}</p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={streaming.streamUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open
              </a>
              <button
                type="button"
                onClick={closeStream}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            {kind === "book" ? (
              streamLoading ? (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Loader className="h-6 w-6 animate-spin" />
                  <p className="text-xs">Loading text…</p>
                </div>
              ) : (
                <div className="h-full w-full max-w-2xl overflow-y-auto rounded-md border bg-card p-6">
                  <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">{streamText}</pre>
                </div>
              )
            ) : kind === "music" ? (
              <div className="w-full max-w-xl rounded-lg border bg-card p-6 text-center">
                <Music2 className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">{streaming.title}</p>
                <audio controls autoPlay src={streaming.streamUrl} className="mt-4 w-full" />
              </div>
            ) : (
              <video controls autoPlay src={streaming.streamUrl} className="max-h-full w-full max-w-4xl rounded-lg border bg-black" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
