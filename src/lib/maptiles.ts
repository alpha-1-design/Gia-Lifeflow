import * as maplibregl from "maplibre-gl";
import { clearTiles, getCachedTile, putCachedTile, tileCacheStats, tileKey } from "./tilecache";

const DARK_URL = "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";

export function darkTileUrl(z: number, x: number, y: number): string {
  return DARK_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

/** The custom-protocol URL the map uses so tiles can be served from cache. */
export function lifeflowTileUrl(z: number, x: number, y: number): string {
  return `lifeflow://dark/${z}/${x}/${y}.png`;
}

let registered = false;

/** Register the `lifeflow://` protocol once: cache-first, network-fill. */
export function ensureTileProtocol(): void {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol("lifeflow", async (params) => {
    const m = /^lifeflow:\/\/dark\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error("Unsupported tile URL");
    const z = Number(m[1]);
    const x = Number(m[2]);
    const y = Number(m[3]);
    const key = tileKey("dark", z, x, y);
    const cached = await getCachedTile(key);
    if (cached) return { data: await cached.arrayBuffer() };
    const res = await fetch(darkTileUrl(z, x, y));
    if (!res.ok) throw new Error(`Tile HTTP ${res.status}`);
    const blob = await res.blob();
    void putCachedTile(key, blob);
    return { data: await blob.arrayBuffer() };
  });
}

export interface TileBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

function tileRange(bounds: TileBounds, z: number) {
  const n = 2 ** z;
  const x0 = Math.max(0, Math.floor(((bounds.west + 180) / 360) * n));
  const x1 = Math.min(n - 1, Math.floor(((bounds.east + 180) / 360) * n));
  const latToY = (lat: number) =>
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const y0 = Math.max(0, Math.floor(latToY(bounds.north)));
  const y1 = Math.min(n - 1, Math.floor(latToY(bounds.south)));
  return { x0, x1, y0, y1 };
}

export interface DownloadAreaOptions {
  bounds: TileBounds;
  minZoom: number;
  maxZoom: number;
  maxTiles?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Pre-fetch every tile in a bounding box across a zoom range into the cache. */
export async function downloadArea(opts: DownloadAreaOptions): Promise<number> {
  const jobs: { z: number; x: number; y: number }[] = [];
  for (let z = opts.minZoom; z <= opts.maxZoom; z++) {
    const r = tileRange(opts.bounds, z);
    for (let x = r.x0; x <= r.x1; x++) {
      for (let y = r.y0; y <= r.y1; y++) jobs.push({ z, x, y });
    }
  }
  const maxTiles = opts.maxTiles ?? 1000;
  const list = jobs.slice(0, maxTiles);
  const total = list.length;
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: 8 }, async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= total) break;
      const j = list[idx];
      const key = tileKey("dark", j.z, j.x, j.y);
      if (!(await getCachedTile(key))) {
        try {
          const res = await fetch(darkTileUrl(j.z, j.x, j.y));
          if (res.ok) await putCachedTile(key, await res.blob());
        } catch {
          /* skip unreachable tiles */
        }
      }
      done++;
      opts.onProgress?.(done, total);
    }
  });
  await Promise.all(workers);
  return total;
}

export { tileCacheStats, clearTiles };
