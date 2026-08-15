import { Plus, Settings2 } from "lucide-react";
import { useState } from "react";

import { startDownload } from "@/lib/downloader";
import { filenameFromUrl } from "@/lib/format";

interface DownloadFormProps {
  kind: "music" | "movie" | "book";
  urlPlaceholder: string;
}

/**
 * Shared "download from a link" form. Paste any direct link; optionally add an
 * Authorization header for private hosts, or enable the public CORS relay for
 * sites that refuse to serve cross-origin fetches (the relay is only used when
 * a direct attempt fails).
 */
export default function DownloadForm({ kind, urlPlaceholder }: DownloadFormProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState(false);
  const [auth, setAuth] = useState("");
  const [useRelay, setUseRelay] = useState(false);

  const start = () => {
    if (!url.trim()) return;
    const headers = auth.trim() ? { Authorization: auth.trim() } : undefined;
    void startDownload({
      url: url.trim(),
      kind,
      title: title.trim() || filenameFromUrl(url),
      headers,
      useRelay,
    });
    setUrl("");
    setTitle("");
    setAuth("");
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") start();
          }}
          placeholder={urlPlaceholder}
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
          onClick={start}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> Start
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOptions((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Settings2 className="h-3.5 w-3.5" />
          {options ? "Hide options" : "Options (headers, blocked sites)"}
        </button>
        {options && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={useRelay}
              onChange={(e) => setUseRelay(e.target.checked)}
              className="accent-foreground"
            />
            Use public relay if the site blocks direct download
          </label>
        )}
      </div>

      {options && (
        <div className="mt-2">
          <input
            value={auth}
            onChange={(e) => setAuth(e.target.value)}
            placeholder="Authorization header (optional) — e.g. Bearer <token>"
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Sent only to this host. Browsers don't allow arbitrary Referer/User-Agent headers — use the relay for
            sites that hotlink-protect.
          </p>
        </div>
      )}
    </div>
  );
}
