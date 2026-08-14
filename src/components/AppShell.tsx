import {
  Clapperboard,
  FileText,
  Globe,
  HeartPulse,
  Images,
  LayoutDashboard,
  Library,
  Lock,
  LockOpen,
  Mail,
  MessagesSquare,
  Mic,
  Moon,
  Music,
  NotebookPen,
  Settings as SettingsIcon,
  Shield,
  Sun,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";
import { getSetting, useSetting } from "@/lib/db";
import { fmtTime } from "@/lib/format";
import { maybeSendBriefing } from "@/lib/notifications";
import { unlockDeviceSecurity } from "@/lib/webauthn";
import BlobImage from "@/components/BlobImage";

const EMPTY_PROFILE = { name: "", bio: "", avatarBlobId: undefined as string | undefined };
const EMPTY_SECURITY = { lockEnabled: false, lockKey: null as { credentialId: string; challenge: string } | null };

const NAV = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/notes", label: "Notes", icon: FileText },
  { to: "/app/diary", label: "Diary", icon: NotebookPen },
  { to: "/app/photos", label: "Photos", icon: Images },
  { to: "/app/voice", label: "Voice", icon: Mic },
  { to: "/app/music", label: "Music", icon: Music },
  { to: "/app/movies", label: "Movies", icon: Clapperboard },
  { to: "/app/books", label: "Books", icon: Library },
  { to: "/app/health", label: "Health", icon: HeartPulse },
  { to: "/app/mail", label: "Mail", icon: Mail },
  { to: "/app/chat", label: "Chat", icon: MessagesSquare },
  { to: "/app/browser", label: "Browser", icon: Globe },
];

function titleFor(path: string): string {
  if (path.startsWith("/app/books/")) return "Reader";
  const item = NAV.find((n) => path.startsWith(n.to));
  return item?.label ?? "Lifeflow";
}

function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lockKey = useSetting("security", EMPTY_SECURITY)[0].lockKey;

  const unlock = async () => {
    if (!lockKey) return;
    setBusy(true);
    setError("");
    const ok = await unlockDeviceSecurity(lockKey);
    setBusy(false);
    if (ok) onUnlocked();
    else setError("Verification failed or was cancelled.");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background px-6"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background">
          <Shield className="h-4 w-4" />
        </span>
        <span className="text-lg font-semibold tracking-tight">Lifeflow</span>
      </div>
      <p className="microlabel mt-8 mb-4">Locked</p>
      <p className="mb-6 max-w-xs text-center text-sm text-muted-foreground">
        Everything stays on this device. Unlock with your device's own security.
      </p>
      <button
        type="button"
        onClick={unlock}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <LockOpen className="h-4 w-4" />
        {busy ? "Verifying…" : "Unlock with device"}
      </button>
      {error && <p className="mt-4 text-xs text-destructive">{error}</p>}
      <p className="mt-4 max-w-xs text-center text-xs text-muted-foreground">
        Your biometrics or PIN never leave this device.
      </p>
    </motion.div>
  );
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();

  const [profile] = useSetting("profile", EMPTY_PROFILE);
  const [security] = useSetting("security", EMPTY_SECURITY);

  const [booted, setBooted] = useState(false);
  const [locked, setLocked] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Read real settings once so the lock screen doesn't flash.
  useEffect(() => {
    let alive = true;
    getSetting("security", EMPTY_SECURITY).then((s) => {
      if (!alive) return;
      if (s.lockEnabled && s.lockKey) setLocked(true);
      setBooted(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Live clock + on-device briefing check + lock-from-settings signal.
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 30_000);
    const briefing = setInterval(() => {
      void maybeSendBriefing();
    }, 30_000);
    const onLock = () => setLocked(true);
    window.addEventListener("lf-lock", onLock);
    return () => {
      clearInterval(clock);
      clearInterval(briefing);
      window.removeEventListener("lf-lock", onLock);
    };
  }, []);

  if (!booted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="animate-pulse text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Lifeflow
        </span>
      </div>
    );
  }

  const title = titleFor(location.pathname);
  const lockEnabled = security.lockEnabled && !!security.lockKey;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {locked && <LockScreen onUnlocked={() => setLocked(false)} />}

      {/* Sidebar */}
      <aside className="flex h-full w-14 shrink-0 flex-col border-r bg-sidebar md:w-56">
        <div className="flex h-14 items-center gap-2.5 border-b px-3 md:px-5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
            <Shield className="h-3.5 w-3.5" />
          </span>
          <span className="hidden text-[15px] font-semibold tracking-tight md:block">Lifeflow</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 md:px-3">
          <p className="microlabel mb-2 hidden px-2 md:block">Modules</p>
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  title={item.label}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="hidden truncate md:block">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t px-2 py-3 md:px-3">
          <ul className="space-y-0.5">
            <li>
              <button
                type="button"
                onClick={() => setLocked(true)}
                disabled={!lockEnabled}
                title="Lock app"
                className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <Lock className="h-4 w-4 shrink-0" />
                <span className="hidden truncate md:block">Lock</span>
              </button>
            </li>
            <li>
              <NavLink
                to="/app/settings"
                title="Settings"
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )
                }
              >
                <SettingsIcon className="h-4 w-4 shrink-0" />
                <span className="hidden truncate md:block">Settings</span>
              </NavLink>
            </li>
          </ul>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 md:px-6">
          <div className="flex items-center gap-3">
            <span className="microlabel">{title}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Toggle theme"
            >
              {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <span className="hidden font-mono text-sm tabular-nums text-muted-foreground sm:block">
              {fmtTime(now)}
            </span>
            {profile.name && (
              <button
                type="button"
                onClick={() => navigate("/app/settings")}
                className="flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2 transition-colors hover:bg-accent"
              >
                {profile.avatarBlobId ? (
                  <BlobImage blobId={profile.avatarBlobId} className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
                    {(profile.name || "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="hidden text-sm md:block">{profile.name}</span>
              </button>
            )}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
