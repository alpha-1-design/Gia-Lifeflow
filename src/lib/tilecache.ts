import { db } from "./db";

/**
 * Offline map tile cache — map tiles are stored as blobs in IndexedDB so a
 * previously-downloaded area keeps rendering without a connection.
 */
export interface TileRecord {
  id: string;
  blob: Blob;
  size: number;
  ts: number;
}

export function tileKey(provider: string, z: number, x: number, y: number): string {
  return `${provider}:${z}:${x}:${y}`;
}

export async function getCachedTile(key: string): Promise<Blob | undefined> {
  const d = await db();
  const row = (await d.get("tiles", key)) as TileRecord | undefined;
  return row?.blob;
}

export async function putCachedTile(key: string, blob: Blob): Promise<void> {
  const d = await db();
  await d.put("tiles", { id: key, blob, size: blob.size, ts: Date.now() } satisfies TileRecord);
}

export async function tileCacheStats(): Promise<{ tiles: number; bytes: number }> {
  const d = await db();
  const all = (await d.getAll("tiles")) as TileRecord[];
  return { tiles: all.length, bytes: all.reduce((s, t) => s + (t.size ?? 0), 0) };
}

export async function clearTiles(): Promise<void> {
  const d = await db();
  await d.clear("tiles");
}
