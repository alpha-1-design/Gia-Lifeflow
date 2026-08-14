import {
  Archive,
  Bell,
  Database,
  Download,
  Github,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Shield,
  Sparkles,
  Sun,
  Trash2,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import BlobImage from "@/components/BlobImage";
import {
  db,
  useSetting,
  setSetting,
  removeSetting,
  saveBlob,
  deleteBlob,
  getStorageUsage,
  clearStore,
  getAll,
  type Profile,
} from "@/lib/db";
import { fmtBytes } from "@/lib/format";
import {
  enrollDeviceSecurity,
  isDeviceSecurityAvailable,
  isNativePlatform,
  type PasskeyRecord,
} from "@/lib/webauthn";
import { ensureNotificationPermission, testNotification } from "@/lib/notifications";
import { fetchGithubStats, clearLiveCache } from "@/lib/clients";
import { gmailRedirectUri, handleGoogleCallback, refreshIfNeeded, startGoogleAuth, type GoogleConn } from "@/lib/gmail";
import { AI_PROVIDERS, chatCompletion, DEFAULT_AI_CONFIG, providerIdFor, type AiConfig } from "@/lib/ai";
import { exportEncrypted, restoreFromFile } from "@/lib/backup";
import {
  clearNativeCredentials,
  isMailBridgeAvailable,
  readNativeCredentials,
  storeNativeCredentials,
  testAppPassword,
} from "@/lib/mailbridge";

const EMPTY_PROFILE: Profile = { name: "", bio: "", avatarBlobId: undefined };
const EMPTY_SECURITY = { lockEnabled: false, lockKey: null as PasskeyRecord | null };
const EMPTY_GITHUB = { username: "", token: "" };
const EMPTY_NOTIF = { enabled: false, briefingTime: "08:00" };
const EMPTY_GOOGLE = null as GoogleConn | null;
const EMPTY_APP_PW = { email: "", appPassword: "" };

function Section({ icon: Icon, title, desc, children }: { icon: typeof User; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="quiet-card p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

const inputCls =
  "rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40 w-full";

export default function Settings() {
  const { resolvedTheme, setTheme } = useTheme();
  const [profile, setProfile] = useSetting<Profile>("profile", EMPTY_PROFILE);
  const [security, setSecurity] = useSetting<typeof EMPTY_SECURITY>("security", EMPTY_SECURITY);
  const [github, setGithub] = useSetting<typeof EMPTY_GITHUB>("github", EMPTY_GITHUB);
  const [notif, setNotif] = useSetting<typeof EMPTY_NOTIF>("notifications", EMPTY_NOTIF);
  const [google, setGoogle] = useSetting<GoogleConn | null>("google", EMPTY_GOOGLE);
  const [weatherCity, setWeatherCity] = useSetting<string>("weatherCity", "");
  const [newsFeeds, setNewsFeeds] = useSetting<string[]>("newsFeeds", []);

  const [appPw, setAppPw] = useSetting<typeof EMPTY_APP_PW>("googleAppPassword", EMPTY_APP_PW);
  const [ai, setAi] = useSetting<AiConfig>("ai", DEFAULT_AI_CONFIG);

  const [clientId, setClientId] = useState("");
  const [storage, setStorage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [secAvailable, setSecAvailable] = useState(false);
  const [nativeCreds, setNativeCreds] = useState<{ email: string; appPassword: string } | null>(null);

  const [aiBusy, setAiBusy] = useState(false);
  const [bkPass, setBkPass] = useState("");
  const [bkPass2, setBkPass2] = useState("");
  const [bkIncludeMedia, setBkIncludeMedia] = useState(true);
  const [bkBusy, setBkBusy] = useState(false);
  const [restorePass, setRestorePass] = useState("");

  useEffect(() => {
    void getStorageUsage().then(setStorage);
    void isDeviceSecurityAvailable().then(setSecAvailable);
    if (isMailBridgeAvailable()) {
      void readNativeCredentials().then((c) => {
        setNativeCreds(c);
        if (c) setAppPw({ email: c.email, appPassword: c.appPassword });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveProfile = async () => {
    await setSetting("profile", profile);
    toast("Profile saved");
  };

  const uploadAvatar = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (profile.avatarBlobId) await deleteBlob(profile.avatarBlobId);
    const id = await saveBlob(f, f.type);
    setProfile({ ...profile, avatarBlobId: id });
    toast("Avatar updated");
  };

  const enableLock = async () => {
    setBusy(true);
    try {
      const record = await enrollDeviceSecurity(profile.name || "Lifeflow user");
      setSecurity({ lockEnabled: true, lockKey: record });
      toast(
        isNativePlatform()
          ? "Device lock enabled — biometrics or PIN will unlock Lifeflow"
          : "Device lock enabled — it will ask for your biometrics/PIN on launch",
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not enable device lock");
    } finally {
      setBusy(false);
    }
  };

  const disableLock = async () => {
    setSecurity({ lockEnabled: false, lockKey: null });
    toast("Device lock disabled");
  };

  const lockNow = () => {
    window.dispatchEvent(new Event("lf-lock"));
  };

  const connectGoogle = () => {
    if (clientId.trim()) void startGoogleAuth(clientId.trim());
  };

  const saveAppPassword = async () => {
    const email = appPw.email.trim();
    const pw = appPw.appPassword.trim();
    if (!email || !pw) {
      toast("Enter your Gmail address and the 16-character app password");
      return;
    }
    if (isMailBridgeAvailable()) {
      await storeNativeCredentials(email, pw);
      setNativeCreds({ email, appPassword: pw });
      toast("Saved to the Android Keystore — IMAP/SMTP ready");
    } else {
      await setSetting("googleAppPassword", { email, appPassword: pw });
      toast("Saved on this device (usable in the native app)");
    }
  };

  const testAppPw = async () => {
    const email = appPw.email.trim();
    const pw = appPw.appPassword.trim();
    if (!email || !pw) {
      toast("Enter your Gmail address and app password first");
      return;
    }
    if (!isMailBridgeAvailable()) {
      toast("App passwords need the native Android app — use Google OAuth in the browser");
      return;
    }
    setBusy(true);
    const ok = await testAppPassword(email, pw);
    setBusy(false);
    toast(ok ? "Connected — the app password works" : "Could not connect — check the email and app password");
  };

  const disconnectAppPassword = async () => {
    await clearNativeCredentials();
    setAppPw(EMPTY_APP_PW);
    setNativeCreds(null);
    toast("App password removed");
  };

  const disconnectGoogle = async () => {
    setGoogle(null);
    await clearStore("emails");
    toast("Google disconnected");
  };

  const testGithub = async () => {
    if (!github.username) return toast("Enter your GitHub username");
    setBusy(true);
    const stats = await fetchGithubStats(github.username, github.token);
    setBusy(false);
    if (stats) toast(`Connected — ${stats.publicRepos} repos, ${stats.stars} stars`);
    else toast("Couldn't reach GitHub — check the username and token");
  };

  const exportData = async () => {
    const d = await db();
    const stores = [
      "settings", "notes", "diary", "photos", "voice", "music", "movies",
      "books", "health", "chats", "messages", "downloads", "emails", "browser",
    ] as const;
    const out: Record<string, unknown> = {};
    for (const s of stores) out[s] = await d.getAll(s);
    const blobs = (await d.getAll("blobs")) as { id: string; type?: string; blob: Blob }[];
    out.blobs = blobs.map((b) => ({ id: b.id, type: b.type, size: b.blob.size }));
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lifeflow-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Export downloaded — media blobs included as metadata");
  };

  const wipeAll = async () => {
    if (!window.confirm("Erase ALL Lifeflow data on this device? This cannot be undone.")) return;
    const stores = [
      "settings", "blobs", "notes", "diary", "photos", "voice", "music", "movies",
      "books", "health", "chats", "messages", "downloads", "chunks", "cache", "emails", "browser",
    ] as const;
    for (const s of stores) await clearStore(s);
    await clearLiveCache();
    window.location.reload();
  };

  const testAi = async () => {
    if (!ai.apiKey.trim()) return toast("Enter an API key first");
    setAiBusy(true);
    try {
      await chatCompletion(ai, [{ role: "user", content: "Reply with exactly: OK" }]);
      toast("Connected — the model answered");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not reach the model");
    } finally {
      setAiBusy(false);
    }
  };

  const exportEncryptedBackup = async () => {
    if (bkPass.length < 4) return toast("Choose a passphrase of at least 4 characters");
    if (bkPass !== bkPass2) return toast("Passphrases don't match");
    setBkBusy(true);
    try {
      const r = await exportEncrypted(bkPass, bkIncludeMedia);
      toast(
        r.skippedBlobs > 0
          ? `Backup saved — ${r.embeddedBlobs} media embedded, ${r.skippedBlobs} large files kept as metadata`
          : `Backup saved (${r.embeddedBlobs} media items included)`,
      );
      setBkPass("");
      setBkPass2("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBkBusy(false);
    }
  };

  const restoreBackup = async (file: File) => {
    if (!restorePass) return toast("Enter the backup passphrase");
    if (!window.confirm("Restoring replaces ALL current data on this device with the backup. Continue?")) return;
    setBkBusy(true);
    try {
      const r = await restoreFromFile(file, restorePass);
      toast(`Restored ${r.restored.length} stores${r.blobsRestored > 0 ? ` + ${r.blobsRestored} media files` : ""}`);
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      const err = e as Error;
      toast(err.name === "OperationError" ? "Wrong passphrase or corrupted file" : err.message || "Restore failed");
    } finally {
      setBkBusy(false);
    }
  };

  const handleCallback = async () => {
    if (!window.location.search.includes("code=") && !window.location.search.includes("error=")) return;
    try {
      const c = await handleGoogleCallback();
      if (c) {
        setGoogle(c);
        toast("Google connected");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Google sign-in failed");
    }
  };

  useEffect(() => {
    void handleCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <PageHeader eyebrow="System" title="Settings" description="Everything about you — and only you." />

      <div className="space-y-4">
        <Section icon={User} title="Profile" desc="Shown on the dashboard greeting and header.">
          <div className="flex flex-wrap items-center gap-4">
            {profile.avatarBlobId ? (
              <BlobImage blobId={profile.avatarBlobId} className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-xl font-semibold text-background">
                {(profile.name || "LF").slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="flex-1 space-y-2">
              <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Your name" className={inputCls} />
              <input value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} placeholder="A short bio" className={inputCls} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
              Upload photo
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { void uploadAvatar(e.target.files); e.target.value = ""; }} />
            </label>
            {profile.avatarBlobId && (
              <button
                type="button"
                onClick={() => {
                  if (profile.avatarBlobId) void deleteBlob(profile.avatarBlobId);
                  setProfile({ ...profile, avatarBlobId: undefined });
                }}
                className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                Remove photo
              </button>
            )}
            <button type="button" onClick={() => void saveProfile()} className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90">
              Save profile
            </button>
          </div>
        </Section>

        <Section icon={Lock} title="Security" desc="Gate the app behind your device's own unlock.">
          <Row label="Use device security (biometrics / PIN / passkey)">
            {security.lockEnabled ? (
              <button type="button" onClick={disableLock} className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
                Disable
              </button>
            ) : (
              <button type="button" onClick={() => void enableLock()} disabled={busy || !secAvailable} className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40">
                {busy ? "Checking…" : "Enable"}
              </button>
            )}
          </Row>
          {security.lockEnabled && (
            <Row label="Lock the app now">
              <button type="button" onClick={lockNow} className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
                Lock now
              </button>
            </Row>
          )}
          {!secAvailable && !security.lockEnabled && (
            <p className="mt-2 text-xs text-muted-foreground">
              {isNativePlatform()
                ? "Set up a fingerprint, face unlock or PIN in your device settings first."
                : "Device security isn't available in this browser — it works in the native app and on supported browsers."}
            </p>
          )}
        </Section>

        <Section icon={KeyRound} title="Connections" desc="Optional live data. Everything is fetched directly from your device.">
          <Row label="Google / Gmail">
            {google ? (
              <div className="flex items-center gap-2">
                <span className="text-sm">{google.email}</span>
                <button type="button" onClick={() => void disconnectGoogle()} className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="flex w-full flex-col items-end gap-2">
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Google OAuth Client ID" className={`${inputCls} max-w-sm`} />
                <button type="button" onClick={connectGoogle} disabled={!clientId.trim()} className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40">
                  Connect Google
                </button>
                <p className="text-[11px] text-muted-foreground">
                  Redirect URI to whitelist: <code className="font-mono">{gmailRedirectUri()}</code>
                </p>
              </div>
            )}
          </Row>
          <Row label="GitHub username">
            <input value={github.username} onChange={(e) => setGithub({ ...github, username: e.target.value })} placeholder="octocat" className={`${inputCls} max-w-xs`} />
          </Row>
          <Row label="GitHub personal token">
            <input value={github.token} onChange={(e) => setGithub({ ...github, token: e.target.value })} placeholder="ghp_… (optional, for private stats)" type="password" className={`${inputCls} max-w-xs`} />
            <button type="button" onClick={() => void testGithub()} disabled={busy} className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40">
              Test
            </button>
          </Row>
          <Row label="Weather city (optional)">
            <input value={weatherCity} onChange={(e) => setWeatherCity(e.target.value)} placeholder="e.g. Tokyo" className={`${inputCls} max-w-xs`} />
          </Row>
          <Row label="News feeds">
            <input
              value={newsFeeds.join(", ")}
              onChange={(e) => setNewsFeeds(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
              placeholder="https://feeds.bbci.co.uk/news/rss.xml, …"
              className={`${inputCls} max-w-md`}
            />
          </Row>
        </Section>

        <Section icon={KeyRound} title="Google app password" desc="IMAP/SMTP access for the native Android app — no OAuth client needed.">
          <p className="text-xs leading-relaxed text-muted-foreground">
            A Google app password is a 16-character passcode you generate at{" "}
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-border underline-offset-2 hover:text-foreground"
            >
              myaccount.google.com/apppasswords
            </a>{" "}
            (2-Step Verification must be on). It grants mail access to exactly this app — it is not your
            account password. App passwords only work over IMAP/SMTP, so in the browser build Lifeflow uses
            Google OAuth instead (above); this section is active in the Android app, where credentials are
            stored in the device Keystore.
          </p>
          <div className="mt-4 space-y-2">
            <input value={appPw.email} onChange={(e) => setAppPw({ ...appPw, email: e.target.value })} placeholder="you@gmail.com" className={inputCls} />
            <input
              value={appPw.appPassword}
              onChange={(e) => setAppPw({ ...appPw, appPassword: e.target.value })}
              placeholder="16-character app password (spaces don't matter)"
              type="password"
              className={inputCls}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void saveAppPassword()} className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90">
                Save
              </button>
              <button type="button" onClick={() => void testAppPw()} disabled={busy} className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40">
                {busy ? "Testing…" : "Test connection"}
              </button>
              {(appPw.email || nativeCreds) && (
                <button type="button" onClick={() => void disconnectAppPassword()} className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
                  Remove
                </button>
              )}
            </div>
            {nativeCreds && (
              <p className="text-[11px] text-muted-foreground">
                Stored in the Android Keystore as <b className="text-foreground">{nativeCreds.email}</b>
              </p>
            )}
            {!isMailBridgeAvailable() && appPw.email && !nativeCreds && (
              <p className="text-[11px] text-muted-foreground">
                Saved locally — it takes effect in the Android app (APK) build.
              </p>
            )}
          </div>
        </Section>

        <Section icon={Sparkles} title="AI companion" desc="A model that can read what's on this device. The key goes only to the endpoint you choose.">
          <Row label="Enable companion">
            <input
              type="checkbox"
              checked={ai.enabled}
              onChange={(e) => setAi({ ...ai, enabled: e.target.checked })}
              className="h-4 w-4 accent-foreground"
            />
          </Row>
          <Row label="API key">
            <input
              type="password"
              value={ai.apiKey}
              onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
              placeholder="sk-…"
              className={`${inputCls} max-w-sm`}
            />
          </Row>
          <Row label="Provider">
            <select
              value={providerIdFor(ai.baseUrl)}
              onChange={(e) => {
                const p = AI_PROVIDERS.find((x) => x.id === e.target.value);
                if (p) setAi({ ...ai, baseUrl: p.baseUrl, model: p.model });
              }}
              className={inputCls}
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </Row>
          <Row label="Base URL">
            <input
              value={ai.baseUrl}
              onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className={`${inputCls} max-w-sm`}
            />
          </Row>
          <Row label="Model">
            <input
              value={ai.model}
              onChange={(e) => setAi({ ...ai, model: e.target.value })}
              placeholder="gpt-4o-mini"
              className={`${inputCls} max-w-[11rem]`}
            />
            <button type="button" onClick={() => void testAi()} disabled={aiBusy} className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40">
              {aiBusy ? "Testing…" : "Test"}
            </button>
          </Row>
          <p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">
            {AI_PROVIDERS.find((p) => p.id === providerIdFor(ai.baseUrl))?.hint ??
              "Any OpenAI-compatible endpoint works. The key is stored only on this device and is sent only to the base URL above. Offline, the dashboard briefing falls back to on-device rules automatically."}
          </p>
        </Section>

        <Section icon={Bell} title="Notifications" desc="Composed and fired on this device — never through a server.">
          <Row label="Daily briefing">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={notif.enabled}
                onChange={(e) => {
                  const v = e.target.checked;
                  setNotif({ ...notif, enabled: v });
                  if (v) void ensureNotificationPermission().then((ok) => { if (!ok) toast("Notification permission denied"); });
                }}
              />
              Enabled
            </label>
          </Row>
          <Row label="Briefing time">
            <input
              type="time"
              value={notif.briefingTime}
              onChange={(e) => setNotif({ ...notif, briefingTime: e.target.value })}
              className="rounded-md border bg-transparent px-3 py-1.5 text-sm"
            />
          </Row>
          <Row label="Test">
            <button type="button" onClick={testNotification} className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
              Send test
            </button>
          </Row>
        </Section>

        <Section icon={Sun} title="Appearance" desc="Quiet, near-monochrome. Your choice of light or dark.">
          <Row label="Theme">
            <div className="flex gap-1.5">
              {(["light", "dark", "system"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${
                    resolvedTheme === t || (t === "system" && !resolvedTheme) ? "bg-foreground text-background" : "border hover:bg-accent"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        <Section icon={Shield} title="Privacy & data" desc="Lifeflow has no account, no analytics, no cloud sync.">
          <div className="rounded-md border border-dashed p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Your data never leaves this device.</p>
            <p className="mt-1">
              Notes, diary, photos, voice memos, media, health and chat history live in this device's local
              storage (IndexedDB). No usage telemetry is collected, no account is created, and no request goes
              to Lifeflow's infrastructure — weather, news, GitHub and mail are fetched directly from your
              device to those public services (news feeds that block browsers fall back to a generic CORS
              relay, marked in the code).
            </p>
            <p className="mt-1">Storage used: <b className="text-foreground">{fmtBytes(storage)}</b>.</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void exportData()} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
              <Download className="h-3.5 w-3.5" /> Export data (plain JSON)
            </button>
            <button type="button" onClick={() => void wipeAll()} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10">
              <Trash2 className="h-3.5 w-3.5" /> Erase everything
            </button>
          </div>

          <div className="mt-5 rounded-md border p-4">
            <p className="text-sm font-medium">Encrypted backup</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Everything — notes, diary, photos, music, mail, chat, stats — in one passphrase-protected file
              (AES-256-GCM, key derived on-device with 250k PBKDF2 rounds). No cloud, no account: the file is the
              backup, and without the passphrase it is unreadable.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                type="password"
                value={bkPass}
                onChange={(e) => setBkPass(e.target.value)}
                placeholder="Passphrase"
                className={`${inputCls} max-w-xs`}
              />
              <input
                type="password"
                value={bkPass2}
                onChange={(e) => setBkPass2(e.target.value)}
                placeholder="Repeat passphrase"
                className={`${inputCls} max-w-xs`}
              />
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={bkIncludeMedia}
                onChange={(e) => setBkIncludeMedia(e.target.checked)}
                className="h-3.5 w-3.5 accent-foreground"
              />
              Include media files (photos, music, films — up to ~250 MB total; larger files are kept as metadata)
            </label>
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void exportEncryptedBackup()}
                disabled={bkBusy}
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <Archive className="h-3.5 w-3.5" /> {bkBusy ? "Working…" : "Export encrypted backup (.lfb)"}
              </button>
            </div>
            <div className="mt-4 border-t pt-4">
              <p className="text-xs font-medium">Restore from backup</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={restorePass}
                  onChange={(e) => setRestorePass(e.target.value)}
                  placeholder="Backup passphrase"
                  className={`${inputCls} max-w-xs`}
                />
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent">
                  Choose .lfb file
                  <input
                    type="file"
                    accept=".lfb,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void restoreBackup(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Restoring replaces everything currently on this device. Device-lock credentials never travel in
                backups.
              </p>
            </div>
          </div>
        </Section>

        <Section icon={Database} title="About" desc="Lifeflow — your entire life, quietly organized.">
          <Row label="Version">
            <span className="text-sm text-muted-foreground">1.0.0 · local-first</span>
          </Row>
          <Row label="Stack">
            <span className="text-sm text-muted-foreground">React · IndexedDB · WebAuthn/Biometrics · WebRTC · libsodium · Open-Meteo · Gmail API · Capacitor</span>
          </Row>
        </Section>
      </div>

      <div className="mt-6 flex items-center gap-2 text-[11px] text-muted-foreground">
        <LogOut className="h-3 w-3" /> No sign-in needed — the app is unlocked by your device, not an account.
        <Mail className="h-3 w-3" /> <Github className="h-3 w-3" /> <Globe className="h-3 w-3" />
      </div>
    </div>
  );
}
