/**
 * Lifeflow Gmail connector.
 *
 * IMAP/SMTP app passwords need raw TCP, which no browser or serverless action
 * provides — so Mail talks to Gmail's REST API directly from this device via
 * OAuth 2.0 (PKCE). The access token is held only in IndexedDB and refreshed
 * on-device. You need a Google OAuth Client ID (type "Web application") with
 * this app's origin + "/app/mail" registered as an authorized redirect URI.
 */

export interface GoogleTokens {
  access: string;
  refresh: string;
  expiry: number; // ms epoch
}

export interface GoogleConn {
  clientId: string;
  email: string;
  tokens: GoogleTokens;
  connectedAt: number;
}

export interface GmailMessage {
  id: string;
  from: string;
  fromName: string;
  subject: string;
  date: number;
  snippet: string;
  body: string;
  unread: boolean;
}

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
].join(" ");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

export function gmailRedirectUri(): string {
  return `${window.location.origin}/app/mail`;
}

function randomBase64Url(bytes: number): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256B64url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toB64url(digest);
}

function toB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Redirects the tab to Google's consent screen. */
export async function startGoogleAuth(clientId: string): Promise<void> {
  const verifier = randomBase64Url(48);
  const challenge = await sha256B64url(verifier);
  sessionStorage.setItem("lf_pkce_verifier", verifier);
  sessionStorage.setItem("lf_pkce_client", clientId);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gmailRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

/** Completes the PKCE exchange when the tab lands back with ?code=. */
export async function handleGoogleCallback(): Promise<GoogleConn | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const error = params.get("error");
  if (error) throw new Error(`Google sign-in failed: ${error}`);
  if (!code) return null;

  const verifier = sessionStorage.getItem("lf_pkce_verifier");
  const clientId = sessionStorage.getItem("lf_pkce_client");
  if (!verifier || !clientId) return null;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      redirect_uri: gmailRedirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const t = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };

  const profile = await fetch(`${GMAIL_URL}/profile`, {
    headers: { Authorization: `Bearer ${t.access_token}` },
  }).then((r) => (r.ok ? (r.json() as Promise<{ emailAddress: string }>) : null));

  sessionStorage.removeItem("lf_pkce_verifier");
  sessionStorage.removeItem("lf_pkce_client");
  window.history.replaceState({}, "", gmailRedirectUri());

  return {
    clientId,
    email: profile?.emailAddress ?? "",
    tokens: {
      access: t.access_token,
      refresh: t.refresh_token,
      expiry: Date.now() + (t.expires_in ?? 3600) * 1000,
    },
    connectedAt: Date.now(),
  };
}

/** Returns an updated conn if the token needed refreshing. */
export async function refreshIfNeeded(conn: GoogleConn): Promise<GoogleConn> {
  if (Date.now() < conn.tokens.expiry - 60_000) return conn;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: conn.clientId,
      refresh_token: conn.tokens.refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("Google token refresh failed — reconnect in Settings");
  const t = (await res.json()) as { access_token: string; expires_in: number };
  return {
    ...conn,
    tokens: {
      ...conn.tokens,
      access: t.access_token,
      expiry: Date.now() + (t.expires_in ?? 3600) * 1000,
    },
  };
}

function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): string {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return decodeURIComponent(
    Array.from(atob(b64 + pad), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
  );
}

function headerValue(headers: { name?: string; value?: string }[], name: string): string {
  const h = headers.find((x) => (x.name ?? "").toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function parseMessage(raw: {
  id?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: { headers?: { name?: string; value?: string }[]; body?: { data?: string }; parts?: { mimeType?: string; body?: { data?: string }; parts?: { mimeType?: string; body?: { data?: string } }[] }[] };
}): GmailMessage {
  const headers = raw.payload?.headers ?? [];
  const fromRaw = headerValue(headers, "From");
  const match = fromRaw.match(/^(.*?)\s*<([^>]+)>$/);
  const fromName = (match?.[1] ?? fromRaw).trim();
  const from = (match?.[2] ?? fromRaw).trim();
  const subject = headerValue(headers, "Subject") || "(no subject)";
  const date = new Date(headerValue(headers, "Date")).getTime() || Date.now();

  let body = "";
  const walk = (p?: { mimeType?: string; body?: { data?: string }; parts?: { mimeType?: string; body?: { data?: string }; parts?: { mimeType?: string; body?: { data?: string } }[] }[] }) => {
    if (!p) return;
    if (p.body?.data && (p.mimeType === "text/plain" || (!p.parts && !body))) {
      try {
        body = b64urlDecode(p.body.data);
      } catch {
        /* ignore */
      }
    }
    (p.parts ?? []).forEach(walk);
  };
  walk(raw.payload);

  return {
    id: raw.id ?? "",
    from,
    fromName: fromName || from || "Unknown",
    subject,
    date,
    snippet: raw.snippet ?? "",
    body: body.replace(/\r\n/g, "\n").slice(0, 60_000),
    unread: (raw.labelIds ?? []).includes("UNREAD"),
  };
}

export async function fetchInbox(access: string, maxResults = 25): Promise<GmailMessage[]> {
  const listRes = await fetch(`${GMAIL_URL}/messages?maxResults=${maxResults}&q=in:inbox`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!listRes.ok) throw new Error(`Gmail list failed (${listRes.status})`);
  const list = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = (list.messages ?? []).map((m) => m.id).filter(Boolean);
  if (ids.length === 0) return [];

  // Gmail's REST API has no `messages.batchGet` route (that only exists for
  // batchModify/batchDelete) — fetching it 404s every time. Fetch each
  // message individually, in parallel, instead.
  const messages = await Promise.all(
    ids.map(async (id) => {
      const res = await fetch(`${GMAIL_URL}/messages/${id}?format=full`, {
        headers: { Authorization: `Bearer ${access}` },
      });
      return res.ok ? ((await res.json()) as unknown) : null;
    }),
  );
  return messages
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .map((m) => parseMessage(m as never))
    .sort((a, b) => b.date - a.date);
}

export async function markRead(access: string, id: string): Promise<void> {
  await fetch(`${GMAIL_URL}/messages/${id}/modify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
}

export async function sendEmail(access: string, to: string, subject: string, body: string): Promise<void> {
  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");
  const res = await fetch(`${GMAIL_URL}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64urlEncode(raw) }),
  });
  if (!res.ok) throw new Error(`Send failed (${res.status})`);
}
