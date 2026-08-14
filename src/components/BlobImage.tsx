import { useEffect, useState } from "react";
import { blobUrl } from "@/lib/db";

/** Image loaded from a Lifeflow blob. Falls back to a neutral placeholder. */
export default function BlobImage({
  blobId,
  alt = "",
  className = "",
}: {
  blobId?: string;
  alt?: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setFailed(false);
    setUrl(null);
    if (!blobId) return;
    blobUrl(blobId).then((u) => {
      if (!alive) return;
      objectUrl = u;
      setUrl(u);
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [blobId]);

  if (!blobId || failed) {
    return (
      <div className={`flex items-center justify-center bg-muted/60 ${className}`}>
        <span className="text-xs font-medium text-muted-foreground/50">—</span>
      </div>
    );
  }

  return url ? (
    <img src={url} alt={alt} className={className} onError={() => setFailed(true)} />
  ) : (
    <div className={`flex items-center justify-center bg-muted/60 ${className}`}>
      <span className="text-xs text-muted-foreground/40">…</span>
    </div>
  );
}
