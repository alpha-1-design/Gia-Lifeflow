import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Box,
  Crosshair,
  Download,
  Loader,
  MapPin,
  Navigation,
  Plus,
  Route as RouteIcon,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import BlobImage from "@/components/BlobImage";
import PageHeader from "@/components/app/PageHeader";
import { useCollection, put, remove, deleteBlob, saveBlob, type Place } from "@/lib/db";
import { fmtBytes, fmtKm, relativeTime, uid } from "@/lib/format";
import { clearTiles, downloadArea, ensureTileProtocol, tileCacheStats } from "@/lib/maptiles";
import type { FeatureCollection, LineString } from "geojson";

const BUILDING_TILES = "https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf";
const ATTR = "© OpenStreetMap contributors © CARTO";

const COUNTRIES: { name: string; lat: number; lng: number }[] = [
  { name: "United States", lat: 39.8, lng: -98.6 },
  { name: "United Kingdom", lat: 54.0, lng: -2.0 },
  { name: "Nigeria", lat: 9.1, lng: 8.7 },
  { name: "Ghana", lat: 7.9, lng: -1.0 },
  { name: "Kenya", lat: -0.0, lng: 37.9 },
  { name: "South Africa", lat: -30.6, lng: 22.9 },
  { name: "India", lat: 22.0, lng: 78.0 },
  { name: "China", lat: 35.0, lng: 104.0 },
  { name: "Japan", lat: 36.2, lng: 138.3 },
  { name: "Brazil", lat: -10.0, lng: -52.0 },
  { name: "Mexico", lat: 23.6, lng: -102.6 },
  { name: "Canada", lat: 56.1, lng: -106.3 },
  { name: "France", lat: 46.6, lng: 2.2 },
  { name: "Germany", lat: 51.2, lng: 10.4 },
  { name: "Spain", lat: 40.5, lng: -3.7 },
  { name: "Italy", lat: 42.8, lng: 12.8 },
  { name: "Netherlands", lat: 52.2, lng: 5.3 },
  { name: "Australia", lat: -25.3, lng: 133.8 },
  { name: "Egypt", lat: 26.8, lng: 30.8 },
  { name: "UAE", lat: 23.4, lng: 53.8 },
  { name: "Indonesia", lat: -0.8, lng: 113.9 },
  { name: "Philippines", lat: 12.9, lng: 121.8 },
];

const POI_CATEGORIES = {
  landmark: { label: "Landmarks", color: "#f59e0b", query: 'node["tourism"](around:R,LAT,LNG);node["historic"](around:R,LAT,LNG);' },
  bus: { label: "Bus stops", color: "#3b82f6", query: 'node["highway"="bus_stop"](around:R,LAT,LNG);' },
  food: { label: "Food & drink", color: "#22c55e", query: 'node["amenity"~"restaurant|cafe|bar|fast_food"](around:R,LAT,LNG);' },
} as const;
type PoiCat = keyof typeof POI_CATEGORIES;

const MAP_STYLE = {
  version: 8,
  sources: {
    dark: { type: "raster", tiles: ["lifeflow://dark/{z}/{x}/{y}.png"], tileSize: 256, attribution: ATTR },
    buildings: { type: "vector", tiles: [BUILDING_TILES], minzoom: 13, maxzoom: 16 },
  },
  layers: [
    { id: "dark", type: "raster", source: "dark" },
    {
      id: "buildings3d",
      type: "fill-extrusion",
      source: "buildings",
      "source-layer": "building",
      minzoom: 14,
      paint: {
        "fill-extrusion-color": "#26334d",
        "fill-extrusion-opacity": 0.85,
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], ["get", "height"], 15],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0],
      },
    },
  ],
} as maplibregl.StyleSpecification;

const EMPTY_FC = (): FeatureCollection => ({ type: "FeatureCollection", features: [] });

interface RouteInfo {
  distance: number;
  duration: number;
  geojson: LineString;
}

const inputCls = "rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40";

export default function Places() {
  const places = useCollection<Place>("places");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [country, setCountry] = useState("");

  // map / routing / POI state
  const [mapReady, setMapReady] = useState(false);
  const [buildings3d, setBuildings3d] = useState(true);
  const [poiCats, setPoiCats] = useState<Record<PoiCat, boolean>>({ landmark: true, bus: false, food: false });
  const [poiLoading, setPoiLoading] = useState(false);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [routing, setRouting] = useState(false);
  const [start, setStart] = useState<{ lat: number; lng: number } | null>(null);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [offlineProgress, setOfflineProgress] = useState<{ done: number; total: number } | null>(null);
  const [offlineStats, setOfflineStats] = useState<{ tiles: number; bytes: number }>({ tiles: 0, bytes: 0 });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const centerRef = useRef<{ lat: number; lng: number }>({ lat: 20, lng: 0 });
  const moveTimer = useRef<number | null>(null);

  /* ------------------------------- map init ------------------------------ */
  useEffect(() => {
    void tileCacheStats().then(setOfflineStats);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    ensureTileProtocol();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [0, 20],
      zoom: 1.5,
      pitch: 50,
      dragRotate: true,
      pitchWithRotate: true,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      map.addSource("pin", { type: "geojson", data: EMPTY_FC() });
      map.addSource("saved", { type: "geojson", data: EMPTY_FC() });
      map.addSource("route", { type: "geojson", data: EMPTY_FC() });
      map.addSource("pois", { type: "geojson", data: EMPTY_FC() });

      map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#818cf8", "line-width": 4, "line-opacity": 0.9 } });
      map.addLayer({ id: "saved-layer", type: "circle", source: "saved", paint: { "circle-radius": 6, "circle-color": "#ef4444", "circle-stroke-color": "#0f172a", "circle-stroke-width": 2 } });
      map.addLayer({ id: "pin-layer", type: "circle", source: "pin", paint: { "circle-radius": 8, "circle-color": "#3b82f6", "circle-stroke-color": "#0f172a", "circle-stroke-width": 2 } });
      (Object.keys(POI_CATEGORIES) as PoiCat[]).forEach((c) => {
        map.addLayer({
          id: `poi-${c}`,
          type: "circle",
          source: "pois",
          filter: ["==", ["get", "cat"], c],
          paint: { "circle-radius": 4, "circle-color": POI_CATEGORIES[c].color, "circle-stroke-color": "#0f172a", "circle-stroke-width": 1 },
        });
      });
      setMapReady(true);
    });

    map.on("click", (e: maplibregl.MapMouseEvent) => {
      const feats = map.queryRenderedFeatures(e.point, { layers: ["saved-layer"] });
      if (feats.length === 0) {
        setPin({ lat: e.lngLat.lat, lng: e.lngLat.lng });
        setActiveId(null);
      }
    });
    map.on("click", "saved-layer", (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) setActiveId(id as string);
    });
    map.on("moveend", () => {
      const c = map.getCenter();
      centerRef.current = { lat: c.lat, lng: c.lng };
      if (moveTimer.current) window.clearTimeout(moveTimer.current);
      moveTimer.current = window.setTimeout(() => {
        setPoiCats((prev) => ({ ...prev })); // trigger POI refresh on settle
      }, 700);
    });

    mapRef.current = map;
    return () => {
      if (moveTimer.current) window.clearTimeout(moveTimer.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 3D buildings toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setLayoutProperty("buildings3d", "visibility", buildings3d ? "visible" : "none");
  }, [buildings3d, mapReady]);

  // pin source
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("pin") as maplibregl.GeoJSONSource | undefined;
    src?.setData(
      pin
        ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [pin.lng, pin.lat] }, properties: {} }] }
        : EMPTY_FC(),
    );
    if (pin) map.flyTo({ center: [pin.lng, pin.lat], zoom: Math.max(map.getZoom(), 15) });
  }, [pin, mapReady]);

  // saved places source
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("saved") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: places.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: { id: p.id },
      })),
    });
  }, [places, mapReady]);

  // route source
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    src?.setData(route ? route.geojson : EMPTY_FC());
    if (route && route.geojson.type === "LineString" && route.geojson.coordinates.length) {
      let minLng = 180;
      let minLat = 90;
      let maxLng = -180;
      let maxLat = -90;
      for (const c of route.geojson.coordinates) {
        minLng = Math.min(minLng, c[0]);
        minLat = Math.min(minLat, c[1]);
        maxLng = Math.max(maxLng, c[0]);
        maxLat = Math.max(maxLat, c[1]);
      }
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60 });
    }
  }, [route, mapReady]);

  /* ------------------------------- actions ------------------------------- */

  const locate = (asStart = true) => {
    if (!navigator.geolocation) return toast("Geolocation isn't available here");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (asStart) setStart(p);
        mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: 15 });
        setPin(p);
      },
      () => {
        setLocating(false);
        toast("Couldn't get your location");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const searchPlace = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
      if (!data.length) return toast("No place found");
      const p = { lat: Number(data[0].lat), lng: Number(data[0].lon) };
      setPin(p);
      if (!name.trim()) setName(data[0].display_name.split(",")[0] ?? data[0].display_name);
      mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: 15 });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const goCountry = () => {
    const c = COUNTRIES.find((x) => x.name === country);
    if (!c) return;
    mapRef.current?.flyTo({ center: [c.lng, c.lat], zoom: 5, pitch: 45 });
  };

  const downloadVisible = async () => {
    const map = mapRef.current;
    if (!map) return;
    const zoom = map.getZoom();
    if (zoom < 8) return toast("Zoom in to the area you want offline first");
    const b = map.getBounds();
    setOfflineBusy(true);
    setOfflineProgress({ done: 0, total: 0 });
    try {
      await downloadArea({
        bounds: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
        minZoom: Math.max(0, Math.floor(zoom) - 1),
        maxZoom: Math.min(17, Math.ceil(zoom) + 2),
        maxTiles: 1000,
        onProgress: (done, total) => setOfflineProgress({ done, total }),
      });
      setOfflineStats(await tileCacheStats());
      toast("Area saved for offline");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Download failed");
    } finally {
      setOfflineBusy(false);
      setOfflineProgress(null);
    }
  };

  const clearOffline = async () => {
    await clearTiles();
    setOfflineStats({ tiles: 0, bytes: 0 });
    toast("Offline map cache cleared");
  };

  const routeTo = async (to: { lat: number; lng: number }) => {
    let from = start;
    if (!from) {
      if (!navigator.geolocation) return toast("Set a start or allow location");
      setLocating(true);
      try {
        from = await new Promise<{ lat: number; lng: number }>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            reject,
            { enableHighAccuracy: true, timeout: 8000 },
          ),
        );
        setStart(from);
      } catch {
        setLocating(false);
        return toast("Couldn't get your location");
      }
      setLocating(false);
    }
    setRouting(true);
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Routing failed (${res.status})`);
      const data = (await res.json()) as { routes?: { distance: number; duration: number; geometry: LineString }[] };
      const r = data.routes?.[0];
      if (!r) throw new Error("No route found");
      setRoute({ distance: r.distance, duration: r.duration, geojson: r.geometry });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not compute a route");
    } finally {
      setRouting(false);
    }
  };

  /* --------------------------------- POIs -------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const enabled = (Object.keys(poiCats) as PoiCat[]).filter((c) => poiCats[c]);
    if (enabled.length === 0) {
      const src = map.getSource("pois") as maplibregl.GeoJSONSource | undefined;
      src?.setData(EMPTY_FC());
      return;
    }
    let alive = true;
    setPoiLoading(true);
    const { lat, lng } = centerRef.current;
    const queries = enabled
      .map((c) =>
        POI_CATEGORIES[c].query.replace(/R/g, "1500").replace(/LAT/g, String(lat)).replace(/LNG/g, String(lng)),
      )
      .join("");
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(`[out:json][timeout:20];(${queries});out body 60;`)}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (!alive) return;
        const elements = (data.elements ?? []) as { type: string; lat: number; lon: number; tags?: Record<string, string> }[];
        const features = elements
          .filter((el) => el.type === "node" && typeof el.lat === "number")
          .map((el) => {
            const t = el.tags ?? {};
            const cat = t.highway === "bus_stop" ? "bus" : t.tourism || t.historic ? "landmark" : "food";
            return {
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: [el.lon, el.lat] },
              properties: { cat, name: t.name ?? "" },
            };
          });
        const src = map.getSource("pois") as maplibregl.GeoJSONSource | undefined;
        src?.setData({ type: "FeatureCollection", features });
      })
      .catch(() => toast("Couldn't load nearby points"))
      .finally(() => {
        if (alive) setPoiLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [poiCats, mapReady]);

  /* ------------------------------ travel diary --------------------------- */

  const savePlace = async () => {
    if (!pin) return toast("Drop a pin on the map first");
    const n = name.trim();
    if (!n) return toast("Give the place a name");
    setSaving(true);
    try {
      const photoBlobIds: string[] = [];
      for (const f of photos) photoBlobIds.push(await saveBlob(f, f.type));
      await put<Place>("places", {
        id: uid(),
        name: n,
        note: note.trim(),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        lat: pin.lat,
        lng: pin.lng,
        photoBlobIds,
        createdAt: Date.now(),
      });
      setPin(null);
      setName("");
      setNote("");
      setTags("");
      setPhotos([]);
      toast("Place saved");
    } catch {
      toast("Could not save the place");
    } finally {
      setSaving(false);
    }
  };

  const removePlace = async (p: Place) => {
    for (const id of p.photoBlobIds) await deleteBlob(id);
    await remove("places", p.id);
    toast("Place removed");
  };

  const sorted = [...places].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div>
      <PageHeader eyebrow="Places" title="Places" description="A dark, 3D map of wherever you are — landmarks, transit, routing, and your travel diary." />

      {/* Map */}
      <div className="relative overflow-hidden rounded-xl border">
        <div ref={containerRef} className="h-[460px] w-full" />

        {/* top-left controls */}
        <div className="absolute top-3 left-3 z-[500] flex w-[calc(100%-6rem)] max-w-lg flex-col gap-2">
          <div className="flex gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border bg-card/95 px-2.5 py-2 shadow-sm backdrop-blur">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void searchPlace();
                }}
                placeholder="Search anywhere…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
              />
              {searching && <Loader className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
            </div>
            <button
              type="button"
              onClick={() => locate(true)}
              disabled={locating}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-card/95 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
              title="My location"
            >
              <Crosshair className={`h-4 w-4 ${locating ? "animate-pulse" : ""}`} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-md border bg-card/95 px-2 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur outline-none">
              <option value="">Jump to a country…</option>
              {COUNTRIES.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={goCountry} disabled={!country} className="rounded-md border bg-card/95 px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground disabled:opacity-40">
              Go
            </button>
            <button
              type="button"
              onClick={() => setBuildings3d((v) => !v)}
              className={`flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs shadow-sm backdrop-blur transition-colors ${buildings3d ? "bg-foreground text-background" : "bg-card/95 text-muted-foreground hover:text-foreground"}`}
              title="Toggle 3D buildings"
            >
              <Box className="h-3.5 w-3.5" /> 3D
            </button>
          </div>

          {/* POI toggles */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(Object.keys(POI_CATEGORIES) as PoiCat[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setPoiCats((prev) => ({ ...prev, [c]: !prev[c] }))}
                className={`rounded-full border px-2.5 py-1 text-[11px] shadow-sm backdrop-blur transition-colors ${poiCats[c] ? "bg-foreground text-background" : "bg-card/95 text-muted-foreground hover:text-foreground"}`}
              >
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: POI_CATEGORIES[c].color }} />
                {POI_CATEGORIES[c].label}
              </button>
            ))}
            {poiLoading && <Loader className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
        </div>

        {/* route summary */}
        {route && (
          <div className="absolute bottom-3 left-3 z-[500] flex items-center gap-2 rounded-md border bg-card/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
            <Navigation className="h-3.5 w-3.5 text-indigo-300" />
            <span className="font-medium">{fmtKm(route.distance)}</span>
            <span className="text-muted-foreground">· {Math.round(route.duration / 60)} min</span>
            <button type="button" onClick={() => setRoute(null)} className="ml-1 text-muted-foreground transition-colors hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Offline maps */}
      <div className="quiet-card mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="microlabel">Offline maps</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {offlineStats.tiles > 0
                ? `${offlineStats.tiles} tiles · ${fmtBytes(offlineStats.bytes)} cached on this device`
                : "Download the area you're viewing to browse it without a connection."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {offlineStats.tiles > 0 && (
              <button type="button" onClick={() => void clearOffline()} className="rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent">
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => void downloadVisible()}
              disabled={offlineBusy}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Download className="h-4 w-4" /> {offlineBusy ? "Downloading…" : "Download this area"}
            </button>
          </div>
        </div>
        {offlineProgress && (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-foreground transition-all"
                style={{ width: `${offlineProgress.total ? Math.round((offlineProgress.done / offlineProgress.total) * 100) : 0}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {offlineProgress.done} / {offlineProgress.total} tiles
            </p>
          </div>
        )}
      </div>

      {/* Save + route form */}
      <div className="quiet-card mt-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="microlabel">Save a place</p>
          {pin && (
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}
            </span>
          )}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Place name" className={inputCls} />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags (comma separated)" className={inputCls} />
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Memory — what happened here?" className={`${inputCls} mt-3 resize-none`} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent">
            <Upload className="h-4 w-4" /> Photos
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { setPhotos((prev) => [...prev, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
          </label>
          {photos.map((f, i) => (
            <span key={i} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground">
              {f.name}
              <button type="button" onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))} className="transition-colors hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {pin && (
            <button
              type="button"
              onClick={() => void routeTo(pin)}
              disabled={routing}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-40"
            >
              <RouteIcon className="h-4 w-4" /> {routing ? "Routing…" : "Route here"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void savePlace()}
            disabled={saving || !pin}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> {saving ? "Saving…" : "Save place"}
          </button>
        </div>
      </div>

      {/* Saved places */}
      {sorted.length === 0 ? (
        <div className="quiet-card mt-4 flex flex-col items-center p-12 text-center">
          <MapPin className="h-7 w-7 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">No places yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Search a spot or drop a pin, then save it with photos and memories.</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((p) => (
            <div key={p.id} className={`quiet-card overflow-hidden p-0 transition-all ${activeId === p.id ? "ring-2 ring-foreground/30" : ""}`}>
              {p.photoBlobIds.length > 0 ? (
                <div className="flex aspect-[16/9] gap-px overflow-hidden bg-black/20">
                  {p.photoBlobIds.slice(0, 3).map((id) => (
                    <BlobImage key={id} blobId={id} className="h-full flex-1 object-cover" />
                  ))}
                </div>
              ) : (
                <div className="flex aspect-[16/9] items-center justify-center bg-accent/40">
                  <MapPin className="h-8 w-8 text-muted-foreground/40" />
                </div>
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-snug">{p.name}</p>
                  <button type="button" onClick={() => void removePlace(p)} className="text-muted-foreground transition-colors hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {p.tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.tags.map((t) => (
                      <span key={t} className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-muted-foreground">#{t}</span>
                    ))}
                  </div>
                )}
                {p.note && <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{p.note}</p>}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">{relativeTime(p.createdAt)}</span>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => { mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: 16 }); setActiveId(p.id); }} className="rounded-md border px-2 py-1 text-[11px] transition-colors hover:bg-accent">
                      Show
                    </button>
                    <button type="button" onClick={() => void routeTo({ lat: p.lat, lng: p.lng })} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors hover:bg-accent">
                      <Navigation className="h-3 w-3" /> Route
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
