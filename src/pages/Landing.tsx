import { motion } from "framer-motion";
import { ArrowRight, Shield } from "lucide-react";
import { Link } from "react-router";

const MODULES = [
  { n: "01", title: "Dashboard", desc: "Your day at a glance — greeting, clock, weather, news and stats, assembled on your device." },
  { n: "02", title: "Notes", desc: "Fast notes with photo attachments, tags and pinning. Autosaved, searchable, yours." },
  { n: "03", title: "Diary", desc: "A quiet page per day — mood, words, photos. History grouped by month." },
  { n: "04", title: "Photos", desc: "Your pictures held locally with captions and a clean gallery." },
  { n: "05", title: "Voice", desc: "Record thoughts aloud. Encoded and stored on-device." },
  { n: "06", title: "Music", desc: "Import tracks or accelerate downloads, then play with lock-screen controls." },
  { n: "07", title: "Movies", desc: "Films on your device with resumable, chunked downloads." },
  { n: "08", title: "Books", desc: "Epub, PDF and text — read with progress that follows you." },
  { n: "09", title: "Health", desc: "Sleep, weight, movement, water, meals — with honest trend charts." },
  { n: "10", title: "Mail", desc: "Connect Gmail via OAuth. Your inbox, read and sent from this device." },
  { n: "11", title: "Chat", desc: "Peer-to-peer, end-to-end encrypted. No server, no cloud, no middle." },
  { n: "12", title: "Browser", desc: "A quiet in-app browser with pins and history." },
];

const STATS = [
  { k: "0", v: "accounts" },
  { k: "0", v: "cloud sync" },
  { k: "0", v: "telemetry" },
  { k: "1", v: "device" },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background">
              <Shield className="h-3.5 w-3.5" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Lifeflow</span>
          </div>
          <Link
            to="/app/dashboard"
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Open the app <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="max-w-3xl"
          >
            <p className="microlabel">Local-first · Private by design</p>
            <h1 className="mt-4 text-5xl leading-[1.05] font-semibold tracking-tight md:text-7xl">
              Your entire life,
              <br />
              quietly organized.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Notes, diary, photos, music, films, books, health, mail, and an encrypted
              peer-to-peer chat — all on one device. No account, no cloud, no telemetry.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/app/dashboard"
                className="inline-flex h-11 items-center gap-2 rounded-md bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                Start — no sign-up <ArrowRight className="h-4 w-4" />
              </Link>
              <span className="text-xs text-muted-foreground">
                Works offline. Everything is stored on this device.
              </span>
            </div>
          </motion.div>

          {/* Stats strip */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25, duration: 0.6 }}
            className="mt-20 grid grid-cols-2 gap-px border md:grid-cols-4"
          >
            {STATS.map((s) => (
              <div key={s.v} className="bg-background p-6">
                <p className="text-3xl font-semibold tracking-tight tabular-nums">{s.k}</p>
                <p className="mt-1 text-xs text-muted-foreground">{s.v}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Modules */}
      <section className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="flex items-end justify-between gap-6">
            <div>
              <p className="microlabel">Modules</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Everything, one place.</h2>
            </div>
            <p className="hidden max-w-xs text-sm text-muted-foreground md:block">
              Twelve focused tools. Each one keeps its data locally and stays usable offline.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-px border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((m, i) => (
              <motion.div
                key={m.n}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: (i % 3) * 0.06, duration: 0.45 }}
                className="group bg-background p-6 transition-colors hover:bg-accent/30"
              >
                <p className="font-mono text-xs text-muted-foreground">{m.n}</p>
                <h3 className="mt-3 text-lg font-semibold tracking-tight">{m.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{m.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Privacy */}
      <section className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <p className="microlabel">Privacy</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">
                Built for people who don't want to be watched.
              </h2>
            </div>
            <div className="space-y-5 text-[15px] leading-relaxed text-muted-foreground">
              <p>
                Lifeflow has no account and no sign-up. Your data lives in your browser's
                local storage — notes, diary, photos, recordings, media, health history and
                chat threads never leave this device.
              </p>
              <p>
                The app keeps its own keys and never phones home: no usage statistics are
                collected, and there is nothing for a tracker to find. The only outbound
                calls are the ones you ask for — weather, news, GitHub, and mail — made
                directly to those services.
              </p>
              <p>
                Unlock the app with your device's own biometrics or PIN, and chat
                peer-to-peer with end-to-end encryption. No middleman, no log.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <h2 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight md:text-5xl">
            Quiet power, on your terms.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-muted-foreground">
            Open Lifeflow and take a look around — it's already yours.
          </p>
          <Link
            to="/app/dashboard"
            className="mt-8 inline-flex h-11 items-center gap-2 rounded-md bg-foreground px-7 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Enter Lifeflow <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6">
          <p className="text-xs text-muted-foreground">Lifeflow — local-first life management.</p>
          <p className="text-xs text-muted-foreground">No account · No cloud · No telemetry</p>
        </div>
      </footer>
    </div>
  );
}
