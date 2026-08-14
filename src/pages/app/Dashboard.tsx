import {
  ArrowRight,
  Cloud,
  CloudOff,
  Github,
  Newspaper,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import BlobImage from "@/components/BlobImage";
import { useCollection, useSetting, getStorageUsage } from "@/lib/db";
import { fmtBytes, fmtDateLong, fmtTime, greeting, relativeTime, todayKey } from "@/lib/format";
import { fetchGithubStats, fetchNewsList, fetchWeather, type GithubStats, type NewsItem, type Weather } from "@/lib/clients";

const EMPTY_PROFILE = { name: "", bio: "", avatarBlobId: undefined as string | undefined };
const EMPTY_GITHUB = { username: "", token: "" };
const EMPTY_FEEDS: string[] = [];

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="quiet-card p-4">
      <p className="microlabel">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [profile] = useSetting("profile", EMPTY_PROFILE);
  const [githubCfg] = useSetting("github", EMPTY_GITHUB);
  const [newsFeeds] = useSetting<string[]>("newsFeeds", EMPTY_FEEDS);
  const [now, setNow] = useState(() => new Date());

  const notes = useCollection<any>("notes");
  const diary = useCollection<any>("diary");
  const photos = useCollection<any>("photos");
  const health = useCollection<any>("health");
  const music = useCollection<any>("music");
  const movies = useCollection<any>("movies");
  const books = useCollection<any>("books");
  const downloads = useCollection<any>("downloads");
  const emails = useCollection<any>("emails");

  const [weather, setWeather] = useState<Weather | null>(null);
  const [gh, setGh] = useState<GithubStats | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [storage, setStorage] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  const loadLive = useCallback(async (force = false) => {
    setWeather(await fetchWeather(force));
    const items = await fetchNewsList(force, newsFeeds);
    if (items.length) setNews(items);
    if (githubCfg.username) setGh(await fetchGithubStats(githubCfg.username, githubCfg.token));
    setStorage(await getStorageUsage());
  }, [githubCfg.username, githubCfg.token, newsFeeds]);

  useEffect(() => {
    void loadLive();
  }, [loadLive]);

  const today = todayKey(now);
  const healthToday = health.filter((h) => h.date === today);
  const lastSleep = useMemo(() => {
    const sleeps = health
      .filter((h) => h.type === "sleep" && h.data?.hours)
      .sort((a, b) => (a.date > b.date ? -1 : 1));
    return sleeps[0] as any | undefined;
  }, [health]);

  const unread = emails.filter((e) => !e.read).length;
  const activeDl = downloads.filter((d) => d.status === "downloading" || d.status === "queued").length;
  const mediaCount = music.length + movies.length + books.length;

  const concierge = useMemo(() => {
    const parts: string[] = [];
    if (lastSleep?.data?.hours) {
      const h = Number(lastSleep.data.hours);
      parts.push(`you slept ${h.toFixed(1)}h ${lastSleep.date === today ? "last night" : "on " + lastSleep.date}`);
    }
    if (healthToday.length === 0) {
      parts.push("nothing logged yet today — a meal, a walk, or some water is a good start");
    }
    if (unread > 0) parts.push(`${unread} unread email${unread > 1 ? "s" : ""} in your inbox`);
    if (weather) parts.push(`${Math.round(weather.temp)}° and ${weather.desc.toLowerCase()} outside`);
    if (activeDl > 0) parts.push(`${activeDl} download${activeDl > 1 ? "s" : ""} in progress`);
    if (parts.length === 0) parts.push("everything is quiet — take a moment for yourself");
    const greet = `${greeting(now)}, ${profile.name || "friend"}.`;
    return `${greet} ${parts[0][0].toUpperCase()}${parts.slice(0, 2).join(". ").slice(1)}.`;
  }, [now, lastSleep, healthToday.length, unread, weather, activeDl, profile.name, today]);

  return (
    <div>
      {/* Greeting */}
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          {profile.avatarBlobId ? (
            <BlobImage blobId={profile.avatarBlobId} className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-xl font-semibold text-background">
              {(profile.name || "LF").slice(0, 2).toUpperCase()}
            </span>
          )}
          <div>
            <p className="microlabel">{fmtDateLong(now)}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {greeting(now)}
              {profile.name ? `, ${profile.name}` : ""}
            </h1>
            <p className="mt-0.5 font-mono text-sm text-muted-foreground tabular-nums">{fmtTime(now)}</p>
          </div>
        </div>
        <Link
          to="/app/settings"
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Set up your profile <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Concierge */}
      <div className="quiet-card mt-8 p-5">
        <p className="microlabel">Concierge</p>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-foreground/90">{concierge}</p>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Notes" value={String(notes.length)} sub={`${notes.filter((n) => n.pinned).length} pinned`} />
        <StatCard label="Journal" value={String(diary.length)} sub="diary entries" />
        <StatCard label="Photos" value={String(photos.length)} sub="on device" />
        <StatCard label="Health today" value={String(healthToday.length)} sub={`${activeDl} downloads running`} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Media" value={String(mediaCount)} sub="music · films · books" />
        <StatCard label="Storage" value={fmtBytes(storage)} sub="media only" />
        <StatCard label="Unread mail" value={String(unread)} sub={emails.length > 0 ? "from Gmail" : "not connected"} />
      </div>

      {/* Quick actions */}
      <div className="mt-8">
        <p className="microlabel mb-3">Quick actions</p>
        <div className="flex flex-wrap gap-2">
          {[
            { to: "/app/notes", label: "New note" },
            { to: "/app/diary", label: "Journal today" },
            { to: "/app/voice", label: "Voice memo" },
            { to: "/app/health", label: "Log health" },
            { to: "/app/music", label: "Add music" },
            { to: "/app/movies", label: "Add a film" },
          ].map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent"
            >
              {a.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Live grid */}
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {/* Weather */}
        <div className="quiet-card p-5">
          <div className="flex items-center justify-between">
            <p className="microlabel">Weather</p>
            {weather ? (
              <Cloud className="h-4 w-4 text-muted-foreground" />
            ) : (
              <CloudOff className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          {weather ? (
            <>
              <p className="mt-3 text-4xl font-semibold tracking-tight tabular-nums">{weather.temp}°</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {weather.desc} · feels {weather.feels}°
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                H {weather.high}° / L {weather.low}° · {weather.humidity}% · {weather.wind} km/h · {weather.city}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Offline or unavailable. Set a city in Settings → Connections to pin your location.
            </p>
          )}
        </div>

        {/* GitHub */}
        <div className="quiet-card p-5">
          <div className="flex items-center justify-between">
            <p className="microlabel">GitHub</p>
            <Github className="h-4 w-4 text-muted-foreground" />
          </div>
          {gh ? (
            <>
              <p className="mt-3 truncate text-lg font-semibold tracking-tight">{gh.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {gh.publicRepos} repos · {gh.stars} stars · {gh.followers} followers
              </p>
              {gh.languages.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">{gh.languages.join(" · ")}</p>
              )}
              {gh.recent.length > 0 && (
                <p className="mt-3 truncate text-xs text-muted-foreground">
                  Latest: {gh.recent[0].type.toLowerCase()} in {gh.recent[0].repo}
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              {githubCfg.username
                ? "Couldn't reach GitHub — offline or the username changed."
                : "Connect your GitHub token in Settings → Connections to see stats and projects."}
            </p>
          )}
        </div>

        {/* News */}
        <div className="quiet-card p-5">
          <div className="flex items-center justify-between">
            <p className="microlabel">News</p>
            <div className="flex items-center gap-1">
              <Newspaper className="h-4 w-4 text-muted-foreground" />
              <button
                type="button"
                onClick={() => {
                  setRefreshing(true);
                  void loadLive(true).finally(() => setRefreshing(false));
                }}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent"
                title="Refresh"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          <ul className="mt-3 max-h-56 space-y-3 overflow-y-auto pr-1">
            {news.slice(0, 8).map((item) => (
              <li key={item.id}>
                <a
                  href={item.link}
                  target="_blank"
                  rel="noreferrer"
                  className="group block"
                >
                  <p className="text-sm leading-snug transition-colors group-hover:text-foreground/70">
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {item.source} · {relativeTime(item.date)}
                  </p>
                </a>
              </li>
            ))}
            {news.length === 0 && (
              <li className="text-sm text-muted-foreground">No stories cached yet — refresh when online.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
