# Lifeflow

Your entire life, quietly organized — on one device.

Lifeflow is a local-first life management app: notes, diary, photos, voice
memos, music, films, books, health tracking, mail, a peer-to-peer encrypted
chat, and an in-app browser. **There is no account, no cloud sync, no
telemetry, and no backend.** Everything is stored in your device's local
storage and stays there.

- **Web app** — a Vite + React PWA that runs entirely offline-capable.
- **Android app** — the same app wrapped with Capacitor, shipped as an APK.

## Modules

| Module | What it does |
| --- | --- |
| Dashboard | Greeting, live clock, weather, news, GitHub stats, storage, and your stats for the day — with an optional AI-written briefing that falls back to on-device rules offline |
| Companion | Chat with an AI that can read what's on this device. Any OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter…); the key stays on-device |
| Notes | Fast notes with photo attachments, tags and pinning; autosaved and searchable |
| Diary | A quiet page per day — mood, words, photos; history grouped by month |
| Photos | Your pictures, held locally with captions |
| Voice | Record thoughts aloud; encoded and stored on-device |
| Music | Import tracks or accelerate downloads; playlists, shuffle/repeat, playback speed, a 3-band equalizer, sleep timer, lock-screen controls |
| Movies | Films on your device with resumable downloads, .srt/.vtt subtitles, playback speed and picture-in-picture |
| Books | EPUB, PDF and TXT with progress that follows you |
| Health | Sleep, weight, movement, water, meals — with trend charts |
| Focus | Pomodoro timer with tasks, on-device notifications, daily minutes, streaks and a weekly chart |
| Finance | Local-first spending: transactions, monthly income/spent/balance, category breakdown and per-category budgets |
| Habits | Daily or custom-day habits with morning/evening routines, streaks and 12-week heatmaps |
| Mail | Gmail via OAuth (web + app) **or** your Google app password over IMAP/SMTP (native app) |
| Chat | Peer-to-peer, end-to-end encrypted (X25519 + XSalsa20-Poly1305 via libsodium). No server, no middle |
| Browser | A quiet in-app browser with pins and history |
| Settings | Profile + avatar, device-security lock, connections (Google, GitHub, weather, news, AI), notifications, appearance, encrypted backup/restore, erase |

## Privacy model

- **No backend.** No Lifeflow server exists. The only outbound requests are the
  ones you ask for, made directly from your device: weather (Open-Meteo),
  news (RSS feeds), GitHub, and Gmail.
- **No account.** There is nothing to sign in to. The app can be gated behind
  your device's own security (biometrics / PIN / passkey) — optionally, in
  Settings.
- **No telemetry.** Nothing phones home, and in the Android build `allowBackup`
  is disabled so Android never copies app data to Google's cloud.
- **Chat** is peer-to-peer and end-to-end encrypted; messages are never stored
  anywhere except the two devices involved.
- News feeds that refuse browser CORS fall back to a generic public relay
  (`api.allorigins.win`) — marked in `src/lib/clients.ts`.

## Tech stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui · Framer Motion ·
IndexedDB (via `idb`) · libsodium · WebRTC · WebAuthn · rss-parser ·
Open-Meteo · Gmail API · Capacitor 8 · JavaMail (native IMAP/SMTP bridge)

## Web development

```bash
npm install        # install dependencies
npm run dev        # start the dev server
npm run build      # typecheck + production build to dist/
npm run test       # run unit tests (vitest)
```

## Building the Android APK

### Locally

```bash
npm run apk        # builds web, syncs Capacitor, runs Gradle assembleDebug
```

The APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`. It is
signed with the debug keystore, which is fine for installing on your own
phone. For a Play-ready signed build, create a release keystore and wire the
`signingConfigs` block in `android/app/build.gradle`.

### With GitHub Actions (recommended)

The repository includes `.github/workflows/build-apk.yml`:

1. Push the repo to GitHub.
2. Push a tag: `git tag v1.0.0 && git push origin v1.0.0`
3. The workflow builds the APK, uploads it as an artifact, and attaches it to
   the matching GitHub Release (tag `v*`).

You can also trigger it manually from the **Actions** tab
(`workflow_dispatch`).

### Android permissions (why they exist)

| Permission | Used for |
| --- | --- |
| `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` / `READ_MEDIA_AUDIO` | Photos & Music modules: import media from your device |
| `READ_EXTERNAL_STORAGE` (≤ Android 12) | Same, on older Android |
| `RECORD_AUDIO` | Voice memos |
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | Weather — only when you haven't pinned a city |
| `POST_NOTIFICATIONS` | On-device notifications (briefing, download done) |
| `INTERNET` / `ACCESS_NETWORK_STATE` | Downloads and live data |

## Connecting Gmail

Lifeflow supports two ways to connect Google:

### 1. Google app password (native Android app — no Google Cloud setup)

A **Google app password** is a 16-character passcode that grants a single app
access to your Google account over **IMAP/SMTP only** — it is not your account
password, and it only works for apps that don't speak OAuth.

- Generate one at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
  (requires **2-Step Verification** to be enabled).
- In Lifeflow → Settings → **Google app password**, enter your Gmail address
  and the 16-character code. It's stored in the Android Keystore, and Mail
  reads/sends through Gmail's IMAP (993) and SMTP (465) via the app's native
  `MailBridgePlugin` (JavaMail).
- Browsers can't open raw IMAP/SMTP connections, so app passwords only work in
  the APK build. In the browser, use OAuth below.

### 2. Google OAuth (browser + app)

Works everywhere. One-time setup:

1. [Google Cloud Console](https://console.cloud.google.com) → APIs & Services
   → Credentials → **Create OAuth client ID** → type **Web application**.
2. Add an authorized redirect URI: your origin + `/app/mail`
   (the app shows the exact URI on the Mail connect screen).
3. Enable the **Gmail API** (APIs & Services → Library).
4. Paste the **Client ID** into Mail or Settings → Connections → Connect Google.

Tokens are held only in local storage and refreshed on-device (PKCE).

## Connecting GitHub

Settings → Connections → enter your GitHub username and optionally a personal
access token (for private repos / higher rate limits). Stats, languages and
recent activity appear on the dashboard.

## AI companion

Optional. Settings → AI companion: paste any OpenAI-compatible API key, base
URL and model (OpenAI, Groq, OpenRouter, Together, a local server — all speak
the same `/chat/completions` API). The key is stored only on this device and
sent only to the endpoint you configure.

- The **dashboard briefing** is written by the model when configured (cached
  on-device for 20 minutes) and by deterministic on-device rules otherwise.
- The **Companion** page chats with your data — toggle "include my on-device
  context" to let it read your notes, health, habits, mail, spending and media
  before answering. Conversation history stays in local storage.

## Encrypted backups

Settings → Privacy & data → **Encrypted backup**: export everything (notes,
diary, photos, music, mail, chat, stats…) into a single passphrase-protected
`.lfb` file. Crypto is Web Crypto on-device: PBKDF2-SHA256 (250k iterations)
derives an AES-256-GCM key from your passphrase — without it the file is
unreadable. Restore on this device or a new one; device-lock credentials never
travel in backups, and media blobs are embedded up to ~250 MB (larger files
are kept as metadata).

## Project structure

```
src/
  lib/          db (IndexedDB), downloader, clients (weather/news/GitHub),
                crypto (libsodium), webauthn + biometrics, gmail (OAuth),
                mailbridge (native IMAP/SMTP), notifications
  pages/        Landing + app modules (Dashboard, Notes, Diary, Photos, Voice,
                Music, Movies, Books, Reader, Health, Mail, Chat, Browser, Settings)
  components/   AppShell (sidebar shell + lock screen), shared UI, shadcn/ui
android/        Capacitor Android project (manifest, JavaMail bridge, MainActivity)
.github/        GitHub Actions APK workflow
```

## Export & erase

Settings → Privacy & data lets you export everything as JSON or erase the app
completely. That's the whole data story: your life lives here, and here only.
