import { ImagePlus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import BlobImage from "@/components/BlobImage";
import { useCollection, put, remove, deleteBlob, saveBlob, type Photo } from "@/lib/db";
import { relativeTime, uid } from "@/lib/format";

export default function Photos() {
  const photos = useCollection<Photo>("photos");
  const [viewing, setViewing] = useState<Photo | null>(null);
  const [caption, setCaption] = useState("");

  const sorted = [...photos].sort((a, b) => b.createdAt - a.createdAt);

  useEffect(() => {
    if (viewing) setCaption(viewing.caption);
  }, [viewing]);

  const upload = async (files: FileList | null) => {
    if (!files) return;
    let added = 0;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      const blobId = await saveBlob(f, f.type);
      await put<Photo>("photos", { id: uid(), blobId, caption: "", createdAt: Date.now() });
      added++;
    }
    if (added > 0) toast(`${added} photo${added > 1 ? "s" : ""} added`);
  };

  const saveCaption = async () => {
    if (!viewing) return;
    await put<Photo>("photos", { ...viewing, caption: caption.trim() });
    setViewing(null);
  };

  const removePhoto = async (p: Photo) => {
    await deleteBlob(p.blobId);
    await remove("photos", p.id);
    setViewing(null);
    toast("Photo removed");
  };

  return (
    <div>
      <PageHeader
        eyebrow="Capture"
        title="Photos"
        description="Your pictures, held locally. Nothing is uploaded anywhere."
        actions={
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90">
            <ImagePlus className="h-4 w-4" /> Add photos
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        }
      />

      {sorted.length === 0 ? (
        <div className="quiet-card flex flex-col items-center justify-center p-14 text-center">
          <ImagePlus className="h-6 w-6 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">No photos yet. Add some from your device.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setViewing(p)}
              className="group relative overflow-hidden rounded-md border focus:outline-none"
            >
              <BlobImage blobId={p.blobId} className="aspect-square w-full object-cover" />
              {p.caption && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                  <p className="truncate text-left text-xs text-white">{p.caption}</p>
                </div>
              )}
              <span className="absolute right-1.5 bottom-1.5 hidden text-[10px] text-white/70 group-hover:block">
                {relativeTime(p.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="microlabel">Photo</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => removePhoto(viewing)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewing(null)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <BlobImage blobId={viewing.blobId} className="max-h-full max-w-full rounded-md object-contain" />
          </div>
          <div className="border-t px-4 py-3">
            <div className="mx-auto flex max-w-xl gap-2">
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Add a caption…"
                className="flex-1 rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
              <button
                type="button"
                onClick={() => saveCaption()}
                className="rounded-md bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
