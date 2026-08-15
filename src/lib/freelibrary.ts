/**
 * Free library search.
 *
 * Books come from Project Gutenberg (via Gutendex — no key, direct epub/txt
 * links). Music and films come from the Internet Archive (no key, direct
 * mp3/mp4 links). Both are public-domain / Creative-Commons sources, so every
 * result here is legitimately downloadable and streamable. Downloads go
 * straight into the existing accelerated downloader.
 */
import { relayUrl } from "./downloader";

export type FreeKind = "book" | "music" | "movie";

export interface FreeItem {
  id: string;
  kind: FreeKind;
  title: string;
  creator: string;
  /** File to save to the library. */
  downloadUrl: string;
  /** File to open in-place (read/play without downloading). */
  streamUrl: string;
  coverUrl?: string;
  detail?: string;
}

const TIMEOUT = 20_000;

/* ------------------------------ books ----------------------------------- */

export const BOOK_GENRES: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Fiction", value: "Fiction" },
  { label: "Science Fiction", value: "Science fiction" },
  { label: "Fantasy", value: "Fantasy" },
  { label: "Mystery", value: "Detective and mystery stories" },
  { label: "Adventure", value: "Adventure stories" },
  { label: "Romance", value: "Romance" },
  { label: "Poetry", value: "Poetry" },
  { label: "Biography", value: "Biography" },
  { label: "History", value: "History" },
  { label: "Philosophy", value: "Philosophy" },
  { label: "Religion", value: "Religion" },
  { label: "Children", value: "Children's literature" },
  { label: "Humor", value: "Humor" },
];

interface GutendexResult {
  id: number;
  title: string;
  authors?: { name: string }[];
  formats?: Record<string, string>;
  download_count?: number;
}

/** Search Project Gutenberg through Gutendex. Returns direct epub/txt links. */
export async function searchBooks(query: string, genre: string): Promise<FreeItem[]> {
  const params = new URLSearchParams();
  if (query.trim()) params.set("search", query.trim());
  if (genre) params.set("topic", genre);
  const url = `https://gutendex.com/books?${params.toString()}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Gutenberg search failed (${res.status})`);
  const data = (await res.json()) as { results?: GutendexResult[] };

  return (data.results ?? [])
    .map((r) => {
      const f = r.formats ?? {};
      const epub = f["application/epub+zip"];
      const txt = f["text/plain"] ?? f["text/plain; charset=us-ascii"];
      const html = f["text/html"];
      const cover = f["image/jpeg"] ?? `https://www.gutenberg.org/cache/epub/${r.id}/pg${r.id}.cover.medium.jpg`;
      const downloadUrl = epub ?? txt ?? html;
      const streamUrl = txt ?? html ?? epub;
      return {
        id: String(r.id),
        kind: "book" as const,
        title: r.title,
        creator: (r.authors ?? []).map((a) => a.name).join(", "),
        downloadUrl,
        streamUrl,
        coverUrl: cover,
        detail: `${(r.download_count ?? 0).toLocaleString()} downloads`,
      };
    })
    .filter((r) => r.downloadUrl && r.streamUrl);
}

/* --------------------------- music & movies ------------------------------ */

interface ArchiveDoc {
  identifier: string;
  title?: string;
  creator?: string | string[];
}

/** Pick the best playable file from an Internet Archive item's file list. */
export function pickMediaFile(
  files: { name: string; format?: string }[],
  kind: "music" | "movie",
): string | null {
  const wanted =
    kind === "music"
      ? files.find((f) => /\.(mp3|m4a|ogg|flac)$/i.test(f.name) || /mp3|flac/i.test(f.format ?? ""))
      : files.find((f) => /\.(mp4|webm|m4v)$/i.test(f.name) || /mpeg4/i.test(f.format ?? ""));
  return wanted?.name ?? null;
}

async function resolveArchiveFile(id: string, kind: "music" | "movie"): Promise<string | null> {
  try {
    const res = await fetch(`https://archive.org/metadata/${id}`, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return null;
    const data = (await res.json()) as { files?: { name: string; format?: string }[] };
    const name = pickMediaFile(data.files ?? [], kind);
    if (!name) return null;
    const path = name.split("/").map(encodeURIComponent).join("/");
    return `https://archive.org/download/${id}/${path}`;
  } catch {
    return null;
  }
}

/** Search the Internet Archive for public-domain / CC music or films. */
export async function searchMedia(kind: "music" | "movie", query: string): Promise<FreeItem[]> {
  const mediatype = kind === "music" ? "audio" : "movies";
  const q = query.trim() || (kind === "music" ? "gospel" : "classic films");
  const params = new URLSearchParams({
    q: `${q} AND mediatype:${mediatype}`,
    fl: "identifier,title,creator",
    rows: "24",
    page: "1",
    output: "json",
    sort: "downloads desc",
  });
  const res = await fetch(`https://archive.org/advancedsearch.php?${params.toString()}`, {
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`Archive search failed (${res.status})`);
  const data = (await res.json()) as { response?: { docs?: ArchiveDoc[] } };

  const docs = data.response?.docs ?? [];
  const items = await Promise.all(
    docs.map(async (d): Promise<FreeItem | null> => {
      const fileUrl = await resolveArchiveFile(d.identifier, kind);
      if (!fileUrl) return null;
      return {
        id: d.identifier,
        kind,
        title: d.title || d.identifier,
        creator: Array.isArray(d.creator) ? (d.creator[0] ?? "") : (d.creator ?? ""),
        downloadUrl: fileUrl,
        streamUrl: fileUrl,
        coverUrl: `https://archive.org/services/img/${d.identifier}`,
      };
    }),
  );
  return items.filter((i): i is FreeItem => i !== null);
}

/* ------------------------------ read online ----------------------------- */

/** Fetch plain text for in-place reading, with a CORS-relay fallback. */
export async function fetchText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (res.ok) return await res.text();
  } catch {
    /* fall through to the relay */
  }
  const res = await fetch(relayUrl(url), { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Could not load the text (HTTP ${res.status})`);
  return await res.text();
}
