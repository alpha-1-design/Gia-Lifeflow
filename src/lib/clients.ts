/**
 * Lifeflow live-data clients.
 *
 * Weather (Open-Meteo, keyless), news (RSS feeds parsed on-device), and GitHub
 * (public API). Every result is cached in IndexedDB so the dashboard keeps
 * working offline. There is no backend: all of these talk to public services
 * directly from your device.
 */
import Parser from "rss-parser";
import { db, getOne, put, getSetting } from "./db";

/* ------------------------------- cache --------------------------------- */

const CACHE_TTL = {
  weather: 30 * 60_000,
  news: 15 * 60_000,
  github: 10 * 60_000,
  geocode: 7 * 24 * 60 * 60_000,
};

async function cacheGet<T>(key: string, ttl: number): Promise<T | null> {
  const d = await db();
  const row = (await d.get("cache", key)) as { value: unknown; ts: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.ts > ttl) return null;
  return row.value as T;
}

async function cacheSet(key: string, value: unknown): Promise<void> {
  const d = await db();
  await d.put("cache", { key, value, ts: Date.now() });
}

/* ------------------------------- weather ------------------------------ */

const WMO: Record<number, string> = {
  0: "Clear sky", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Light showers", 81: "Showers", 82: "Violent showers",
  85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm", 99: "Severe thunderstorm",
};

export interface Weather {
  city: string;
  temp: number;
  feels: number;
  humidity: number;
  wind: number;
  code: number;
  desc: string;
  isDay: boolean;
  high: number;
  low: number;
}

async function resolveCoords(): Promise<{ lat: number; lon: number; city: string }> {
  const cached = await getOne<{ lat: number; lon: number; city: string }>("cache", "coords");
  if (cached) return cached;

  // Manual city in settings wins; otherwise try geolocation.
  const city = await getSetting<string>("weatherCity", "");
  if (city.trim()) {
    const geocoded = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.trim())}&count=1&language=en`,
    ).then((r) => (r.ok ? (r.json() as Promise<{ results?: { latitude: number; longitude: number; name: string }[] }>) : null));
    const hit = geocoded?.results?.[0];
    if (hit) {
      const coords = { lat: hit.latitude, lon: hit.longitude, city: hit.name };
      await put("cache", { key: "coords", value: coords, ts: Date.now() });
      return coords;
    }
  }

  const pos = await new Promise<GeolocationPosition | null>((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 5000, maximumAge: 600000 });
  });
  if (pos) {
    const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude, city: "Your location" };
    await put("cache", { key: "coords", value: coords, ts: Date.now() });
    return coords;
  }
  return { lat: 40.7128, lon: -74.006, city: "New York" };
}

export async function fetchWeather(force = false): Promise<Weather | null> {
  const cached = await cacheGet<Weather>("weather", CACHE_TTL.weather);
  if (cached && !force) return cached;
  try {
    const { lat, lon, city } = await resolveCoords();
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
    const res = await fetch(url);
    if (!res.ok) return cached;
    const j = (await res.json()) as {
      current?: {
        temperature_2m: number; relative_humidity_2m: number; apparent_temperature: number;
        is_day: number; weather_code: number; wind_speed_10m: number;
      };
      daily?: { temperature_2m_max: number[]; temperature_2m_min: number[] };
    };
    if (!j.current) return cached;
    const w: Weather = {
      city,
      temp: Math.round(j.current.temperature_2m),
      feels: Math.round(j.current.apparent_temperature),
      humidity: Math.round(j.current.relative_humidity_2m),
      wind: Math.round(j.current.wind_speed_10m),
      code: j.current.weather_code,
      desc: WMO[j.current.weather_code] ?? "Unknown",
      isDay: j.current.is_day === 1,
      high: Math.round(j.daily?.temperature_2m_max?.[0] ?? j.current.temperature_2m),
      low: Math.round(j.daily?.temperature_2m_min?.[0] ?? j.current.temperature_2m),
    };
    await cacheSet("weather", w);
    return w;
  } catch {
    return cached;
  }
}

/* -------------------------------- news -------------------------------- */
/**
 * RSS is parsed on-device with rss-parser — no server in the path. Many feeds
 * block browser CORS, so each feed is tried directly first and falls back to
 * a public CORS relay (allorigins) for feeds that refuse. Results are cached
 * in IndexedDB, so the news grid keeps working offline.
 */

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  date: number;
  snippet: string;
}

export const DEFAULT_FEEDS = [
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://hnrss.org/frontpage",
  "https://www.theverge.com/rss/index.xml",
  "https://feeds.npr.org/1001/rss.xml",
  "https://techcrunch.com/feed/",
] as const;

function makeParser() {
  return new Parser({
    timeout: 9000,
    headers: { "user-agent": "lifeflow/1.0 (+local-first)" },
  });
}

function sourceOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function parseFeedXml(xml: string, source: string): Promise<NewsItem[]> {
  let feed;
  try {
    feed = await makeParser().parseString(xml);
  } catch {
    feed = null;
  }
  if (!feed) return [];
  const items: NewsItem[] = [];
  for (const it of (feed.items ?? []).slice(0, 10)) {
    const title = (it.title ?? "").trim();
    if (!title) continue;
    const date = it.isoDate
      ? new Date(it.isoDate).getTime()
      : it.pubDate
        ? new Date(it.pubDate).getTime()
        : Date.now();
    items.push({
      id: `${source}:${encodeURIComponent(title)}`,
      title,
      link: it.link ?? "",
      source,
      date: Number.isFinite(date) ? date : Date.now(),
      snippet: (it.contentSnippet ?? it.content ?? "").slice(0, 260).trim(),
    });
  }
  return items;
}

async function fetchFeed(url: string): Promise<NewsItem[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (xml.length > 2_000_000) throw new Error("feed too large");
  return parseFeedXml(xml, sourceOf(url));
}

async function fetchFeedViaRelay(url: string): Promise<NewsItem[]> {
  const relay = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const res = await fetch(relay, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  if (xml.length > 2_000_000) throw new Error("feed too large");
  return parseFeedXml(xml, sourceOf(url));
}

export async function fetchNewsList(force = false, feeds?: string[]): Promise<NewsItem[]> {
  const cached = await cacheGet<NewsItem[]>("news", CACHE_TTL.news);
  if (cached && !force) return cached;
  const list = feeds && feeds.length > 0 ? feeds.slice(0, 8) : [...DEFAULT_FEEDS];
  const items: NewsItem[] = [];

  await Promise.all(
    list.map(async (url) => {
      try {
        items.push(...(await fetchFeed(url)));
      } catch {
        try {
          items.push(...(await fetchFeedViaRelay(url)));
        } catch {
          /* a dead or blocked feed must never break the others */
        }
      }
    }),
  );

  items.sort((a, b) => b.date - a.date);
  const trimmed = items.slice(0, 40);
  if (trimmed.length > 0) {
    await cacheSet("news", trimmed);
    return trimmed;
  }
  return cached ?? [];
}

/* ------------------------------- github ------------------------------- */

export interface GithubStats {
  username: string;
  name: string;
  bio: string;
  followers: number;
  publicRepos: number;
  stars: number;
  languages: string[];
  recent: { type: string; repo: string; date: number }[];
}

export async function fetchGithubStats(username: string, token: string): Promise<GithubStats | null> {
  const key = `github:${username}:${token ? "authed" : "public"}`;
  const cached = await cacheGet<GithubStats>(key, CACHE_TTL.github);
  if (cached) return cached;
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const [userRes, reposRes] = await Promise.all([
      fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers }),
      fetch(`https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated`, { headers }),
    ]);
    if (!userRes.ok) return null;
    const user = (await userRes.json()) as { name?: string; bio?: string; followers?: number; public_repos?: number };
    const repos = reposRes.ok ? ((await reposRes.json()) as { stargazers_count: number; language: string | null; full_name: string; pushed_at: string; fork: boolean }[]) : [];
    const owned = repos.filter((r) => !r.fork);
    const langCount = new Map<string, number>();
    owned.forEach((r) => {
      if (r.language) langCount.set(r.language, (langCount.get(r.language) ?? 0) + 1);
    });
    const languages = [...langCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l]) => l);

    let recent: GithubStats["recent"] = [];
    try {
      const eventsRes = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=8`, { headers });
      if (eventsRes.ok) {
        const events = (await eventsRes.json()) as { type: string; repo: { name: string }; created_at: string }[];
        recent = events.map((e) => ({
          type: e.type.replace(/Event$/, "").replace(/([a-z])([A-Z])/g, "$1 $2"),
          repo: e.repo.name.split("/").pop() ?? e.repo.name,
          date: new Date(e.created_at).getTime(),
        }));
      }
    } catch {
      /* optional */
    }

    const stats: GithubStats = {
      username,
      name: user.name ?? username,
      bio: user.bio ?? "",
      followers: user.followers ?? 0,
      publicRepos: user.public_repos ?? owned.length,
      stars: owned.reduce((s, r) => s + r.stargazers_count, 0),
      languages,
      recent: recent.slice(0, 6),
    };
    await cacheSet(key, stats);
    return stats;
  } catch {
    return cached;
  }
}

/* --------------------------- cache cleanup ---------------------------- */

export async function clearLiveCache(): Promise<void> {
  const d = await db();
  await d.clear("cache");
}
