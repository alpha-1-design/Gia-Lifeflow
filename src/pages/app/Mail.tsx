import { ArrowLeft, KeyRound, Mail as MailIcon, PenSquare, RefreshCw, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import {
  useCollection,
  useSetting,
  put,
  clearStore,
  type EmailItem,
} from "@/lib/db";
import {
  fetchInbox,
  gmailRedirectUri,
  handleGoogleCallback,
  markRead,
  refreshIfNeeded,
  sendEmail,
  startGoogleAuth,
  type GoogleConn,
  type GmailMessage,
} from "@/lib/gmail";
import {
  clearNativeCredentials,
  isMailBridgeAvailable,
  nativeFetchInbox,
  nativeSendEmail,
  readNativeCredentials,
  type NativeMailMessage,
} from "@/lib/mailbridge";
import { fmtDateShort, relativeTime } from "@/lib/format";

const EMPTY_GOOGLE = null as GoogleConn | null;
const EMPTY_APP_PW = { email: "", appPassword: "" };

/** Normalizes a native IMAP message into the app's EmailItem shape. */
function nativeToEmail(m: NativeMailMessage, account: string): EmailItem {
  const match = m.from.match(/^(.*?)\s*<([^>]+)>$/);
  return {
    id: m.id,
    from: (match?.[2] ?? m.from).trim(),
    fromName: (match?.[1] ?? m.from).trim() || m.from || "Unknown",
    subject: m.subject || "(no subject)",
    date: m.date || Date.now(),
    snippet: m.snippet || m.body.slice(0, 160),
    body: m.body || "",
    read: false,
    account,
  };
}

export default function Mail() {
  const [conn, setConn] = useSetting<GoogleConn | null>("google", EMPTY_GOOGLE);
  const [appPw, setAppPw] = useSetting<typeof EMPTY_APP_PW>("googleAppPassword", EMPTY_APP_PW);
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<EmailItem | null>(null);
  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [nativeCreds, setNativeCreds] = useState<{ email: string; appPassword: string } | null>(null);

  const emails = useCollection<EmailItem>("emails");
  const sorted = [...emails].sort((a, b) => b.date - a.date);
  const unread = emails.filter((e) => !e.read).length;

  const nativeReady = isMailBridgeAvailable() && !!nativeCreds;
  const activeAccount = conn?.email || (nativeReady ? nativeCreds!.email : "");

  // Read Keystore credentials on native builds.
  useEffect(() => {
    if (isMailBridgeAvailable()) {
      void readNativeCredentials().then((c) => setNativeCreds(c));
    }
  }, []);

  // Handle the OAuth redirect landing back on this page.
  useEffect(() => {
    if (window.location.search.includes("code=") || window.location.search.includes("error=")) {
      void (async () => {
        try {
          const c = await handleGoogleCallback();
          if (c) {
            setConn(c);
            toast("Google account connected");
            await refreshInbox(c, null);
          }
        } catch (e) {
          toast(e instanceof Error ? e.message : "Google sign-in failed");
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshInbox = async (oauth: GoogleConn | null, app: { email: string; appPassword: string } | null) => {
    setBusy(true);
    try {
      if (oauth) {
        const fresh = await refreshIfNeeded(oauth);
        if (fresh !== oauth) setConn(fresh);
        const msgs = await fetchInbox(fresh.tokens.access, 25);
        await clearStore("emails");
        for (const m of msgs) {
          await put<EmailItem>("emails", {
            id: m.id,
            from: m.from,
            fromName: m.fromName,
            subject: m.subject,
            date: m.date,
            snippet: m.snippet,
            body: m.body,
            read: !m.unread,
            account: fresh.email,
          });
        }
        toast(`Inbox synced — ${msgs.length} messages`);
      } else if (app) {
        const msgs = await nativeFetchInbox(app.email, app.appPassword, 25);
        await clearStore("emails");
        for (const m of msgs) {
          await put<EmailItem>("emails", nativeToEmail(m, app.email));
        }
        toast(`Inbox synced — ${msgs.length} messages`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  const openEmail = async (item: EmailItem) => {
    setSelected(item);
    if (item.read) return;
    await put<EmailItem>("emails", { ...item, read: true });
    if (conn) {
      try {
        const fresh = await refreshIfNeeded(conn);
        if (fresh !== conn) setConn(fresh);
        await markRead(fresh.tokens.access, item.id);
      } catch {
        /* offline — local state already updated */
      }
    }
  };

  const send = async () => {
    if (!to.trim() || !subject.trim()) return;
    setBusy(true);
    try {
      if (conn) {
        const fresh = await refreshIfNeeded(conn);
        if (fresh !== conn) setConn(fresh);
        await sendEmail(fresh.tokens.access, to.trim(), subject.trim(), body);
      } else if (nativeReady && nativeCreds) {
        await nativeSendEmail(nativeCreds.email, nativeCreds.appPassword, to.trim(), subject.trim(), body);
      } else {
        throw new Error("No mail connection configured");
      }
      setComposing(false);
      setTo("");
      setSubject("");
      setBody("");
      toast("Email sent");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setConn(null);
    await clearStore("emails");
    setSelected(null);
    toast("Google disconnected — local mail removed");
  };

  const disconnectAppPassword = async () => {
    await clearNativeCredentials();
    setAppPw(EMPTY_APP_PW);
    setNativeCreds(null);
    await clearStore("emails");
    setSelected(null);
    toast("App password removed — local mail cleared");
  };

  /* ------------------------- connect screen -------------------------- */
  if (!conn && !nativeReady) {
    return (
      <div>
        <PageHeader eyebrow="Connections" title="Mail" description="Your inbox on this device." />
        <div className="mx-auto max-w-lg space-y-4">
          {/* OAuth */}
          <div className="quiet-card p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-foreground text-background">
                <MailIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold">Google OAuth</p>
                <p className="text-xs text-muted-foreground">
                  Works everywhere (browser + app). Tokens stay on this device.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-2 rounded-md border border-dashed p-4 text-xs leading-relaxed text-muted-foreground">
              <p className="font-medium text-foreground">One-time setup (2 minutes)</p>
              <p>1. Google Cloud Console → APIs &amp; Services → Credentials → Create OAuth client ID.</p>
              <p>2. Application type: <b>Web application</b>.</p>
              <p>3. Authorized redirect URI — add exactly:</p>
              <code className="block rounded bg-muted px-2 py-1 font-mono break-all text-[11px]">{gmailRedirectUri()}</code>
              <p>4. Enable the <b>Gmail API</b> (APIs &amp; Services → Library → Gmail API → Enable).</p>
              <p>5. Paste the Client ID below and connect. Scopes: read, modify, send.</p>
            </div>

            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Google OAuth Client ID (…apps.googleusercontent.com)"
              className="mt-4 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
            <button
              type="button"
              disabled={!clientId.trim() || busy}
              onClick={() => void startGoogleAuth(clientId.trim())}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Connect Google
            </button>
          </div>

          {/* App password (native) */}
          <div className="quiet-card p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-foreground text-background">
                <KeyRound className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold">Google app password</p>
                <p className="text-xs text-muted-foreground">
                  {isMailBridgeAvailable()
                    ? "IMAP + SMTP straight from the app — no Google Cloud setup."
                    : "Available in the Android app (APK) — IMAP/SMTP needs native networking."}
                </p>
              </div>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Generate a 16-character app password at{" "}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-border underline-offset-2 hover:text-foreground"
              >
                myaccount.google.com/apppasswords
              </a>{" "}
              (2-Step Verification must be on). It is not your account password.
            </p>

            {isMailBridgeAvailable() ? (
              <>
                <div className="mt-4 space-y-2">
                  <input
                    value={appPw.email}
                    onChange={(e) => setAppPw({ ...appPw, email: e.target.value })}
                    placeholder="you@gmail.com"
                    className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
                  />
                  <input
                    value={appPw.appPassword}
                    onChange={(e) => setAppPw({ ...appPw, appPassword: e.target.value })}
                    placeholder="16-character app password"
                    type="password"
                    className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
                  />
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void (async () => {
                    if (!appPw.email.trim() || !appPw.appPassword.trim()) {
                      toast("Enter your Gmail address and app password");
                      return;
                    }
                    setBusy(true);
                    try {
                      const msgs = await nativeFetchInbox(appPw.email.trim(), appPw.appPassword.trim(), 1);
                      setNativeCreds({ email: appPw.email.trim(), appPassword: appPw.appPassword.trim() });
                      await put("settings", { key: "googleAppPassword", value: { email: appPw.email.trim(), appPassword: appPw.appPassword.trim() } });
                      await refreshInbox(null, { email: appPw.email.trim(), appPassword: appPw.appPassword.trim() });
                      if (msgs.length === 0) toast("Connected — inbox is empty");
                    } catch (e) {
                      toast(e instanceof Error ? e.message : "Connection failed — check the app password");
                    } finally {
                      setBusy(false);
                    }
                  })()}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {busy ? "Connecting…" : "Connect with app password"}
                </button>
              </>
            ) : (
              <p className="mt-4 rounded-md border border-dashed p-3 text-[11px] leading-relaxed text-muted-foreground">
                In the browser build, app passwords can't be used (IMAP/SMTP need native networking). Install the
                Android APK to connect this way — or use Google OAuth above, which works everywhere.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------- inbox view ---------------------------- */
  return (
    <div>
      <PageHeader
        eyebrow="Connections"
        title="Mail"
        description={`${activeAccount} — ${unread} unread`}
        actions={
          <>
            <button
              type="button"
              onClick={() => void refreshInbox(conn, nativeReady && nativeCreds ? nativeCreds : null)}
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors hover:bg-accent disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Sync
            </button>
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              <PenSquare className="h-4 w-4" /> Compose
            </button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="max-h-[70vh] space-y-1.5 overflow-y-auto pr-1">
          {sorted.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Inbox is empty — hit Sync.</p>
          )}
          {sorted.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => void openEmail(e)}
              className={`w-full rounded-md border p-3 text-left transition-colors ${
                selected?.id === e.id ? "border-foreground/50 bg-accent/40" : "hover:bg-accent/30"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className={`truncate text-sm ${e.read ? "" : "font-semibold"}`}>{e.fromName}</p>
                <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(e.date)}</span>
              </div>
              <p className={`mt-0.5 truncate text-sm ${e.read ? "text-muted-foreground" : "font-medium"}`}>
                {e.subject}
              </p>
              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{e.snippet}</p>
            </button>
          ))}
        </div>

        <div className="quiet-card min-h-[40vh] p-5">
          {selected ? (
            <>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-3 w-3" /> Back to inbox
              </button>
              <p className="microlabel">{selected.from}</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">{selected.subject}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {selected.fromName} · {fmtDateShort(new Date(selected.date))}
              </p>
              <div className="hairline mt-4 pt-4">
                <p className="text-[14px] leading-relaxed whitespace-pre-wrap">
                  {selected.body || selected.snippet || "(no readable body)"}
                </p>
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center py-16 text-center">
              <MailIcon className="h-6 w-6 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">Select a message to read it.</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between border-t pt-4">
        <p className="text-[11px] text-muted-foreground">
          Connected as {activeAccount} · messages cached locally for offline reading
        </p>
        {conn ? (
          <button
            type="button"
            onClick={() => void disconnect()}
            className="text-xs text-muted-foreground transition-colors hover:text-destructive"
          >
            Disconnect Google
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void disconnectAppPassword()}
            className="text-xs text-muted-foreground transition-colors hover:text-destructive"
          >
            Remove app password
          </button>
        )}
      </div>

      {/* Compose */}
      {composing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="quiet-card w-full max-w-lg p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold">New message</p>
              <button
                type="button"
                onClick={() => setComposing(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              >
                ✕
              </button>
            </div>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="To"
              className="mb-2 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="mb-2 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Message"
              rows={8}
              className="w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm leading-relaxed outline-none focus:border-foreground/40"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !to.trim() || !subject.trim()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Send className="h-4 w-4" /> Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
