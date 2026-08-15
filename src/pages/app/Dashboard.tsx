import {
  ArrowRight,
  Cloud,
  CloudOff,
  Github,
  Newspaper,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import BlobImage from "@/components/BlobImage";
import { useCollection, useSetting, getStorageUsage } from "@/lib/db";
import { fmtBytes, fmtDateLong, fmtTime, greeting, relativeTime, todayKey } from "@/lib/format";
import { fetchGithubStats, fetchNewsList, fetchWeather, type GithubStats, type NewsItem, type Weather } from "@/lib/clients";
import { generateBriefing, DEFAULT_AI_CONFIG, type AiConfig } from "@/lib/ai";

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
  const focusSessions = useCollection<any>("focus");
  const transactions = useCollection<any>("transactions");
  const places = useCollection<any>("places");
  const [aiCfg] = useSetting<AiConfig>("ai", DEFAULT_AI_CONFIG);

  const [weather, setWeather] = useState<Weather | null>(null);
  const [gh, setGh] = useState<GithubStats | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [storage, setStorage] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [briefing, setBriefing] = useState<{ text: string; fromAi: boolean } | null>(null);
  const [briefingBusy, setBriefingBusy] = useState(false);

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
  const unread = emails.filter((e) => !e.read).length;
  const activeDl = downloads.filter((d) => d.status === "downloading" || d.status === "queued").length;
  const mediaCount = music.length + movies.length + books.length;
  const focusToday = focusSessions
    .filter((f) => f.date === today && f.kind === "focus")
    .reduce((a: number, f: any) => a + (Number(f.minutes) || 0), 0);
  const monthKey = today.slice(0, 7);
  const spentMonth = transactions
    .filter((t) => t.kind === "expense" && t.date?.startsWith(monthKey))
    .reduce((a: number, t: any) => a + (Number(t.amount) || 0), 0);

  const loadBriefing = useCallback(async (force = false) => {
    setBriefingBusy(true);
    const b = await generateBriefing(force);
    setBriefing(b);
    setBriefingBusy(false);
  }, []);

  useEffect(() => {
    void loadBriefing();
  }, [loadBriefing]);

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

      {/* Briefing */}
      <div className="quiet-card mt-8 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="microlabel">Briefing</p>
          <div className="flex items-center gap-2">
            {briefing?.fromAi && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Sparkles className="h-3 w-3" /> {aiCfg.model || "AI"}
              </span>
            )}
            <button
              type="button"
              onClick={() => void loadBriefing(true)}
              disabled={briefingBusy}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent"
              title="Regenerate briefing"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${briefingBusy ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        {briefing ? (
          <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-foreground/90">{briefing.text}</p>
        ) : (
          <p className="mt-3 h-4 w-2/3 animate-pulse rounded bg-muted" />
        )}
        {!aiCfg.enabled && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Composed on-device. Add an AI key in Settings → AI companion for a model-written briefing.
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Notes" value={String(notes.length)} sub={`${notes.filter((n) => n.pinned).length} pinned`} />
        <StatCard label="Journal" value={String(diary.length)} sub="diary entries" />
        <StatCard label="Photos" value={String(photos.length)} sub="on device" />
        <StatCard label="Health today" value={String(healthToday.length)} sub={`${activeDl} downloads running`} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Media" value={String(mediaCount)} sub="music · films · books" />
        <StatCard label="Focus today" value={`${focusToday}m`} sub="deep work" />
        <StatCard label="Spent this month" value={`$${spentMonth.toFixed(0)}`} sub="tracked expenses" />
        <StatCard label="Storage" value={fmtBytes(storage)} sub="media only" />
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
            { to: "/app/places", label: "Places" },
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

      {/* Recent places */}
      {places.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <p className="microlabel">Recent places</p>
            <Link to="/app/places" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
              View all
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...places]
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, 3)
              .map((p: any) => (
                <Link key={p.id} to="/app/places" className="quiet-card p-4 transition-colors hover:bg-accent/30">
                  <p className="text-sm font-medium">{p.name}</p>
                  {p.tags?.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.tags.map((t: string) => `#${t}`).join(" ")}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">{relativeTime(p.createdAt)}</p>
                </Link>
              ))}
          </div>
        </div>
      )}

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
