#!/usr/bin/env bun
/**
 * publish.mjs — Publish this project to GitHub using only the REST API.
 *
 * Why: this workspace has no git CLI, so we build the commit object graph
 * through GitHub's Git Database API (blobs -> tree -> commit -> ref).
 *
 * Usage:
 *   GH_TOKEN=<token> bun scripts/publish.mjs            # create (if needed) + push
 *   GH_TOKEN=<token> bun scripts/publish.mjs --private  # force a private repo
 *   GH_REPO=MyRepo  GH_TOKEN=<token> bun scripts/publish.mjs
 *
 * The token needs repo scope (or, for a fine-grained PAT: Contents read/write
 * on the target repo plus the ability to create repositories).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
  console.error("Missing GH_TOKEN environment variable.");
  process.exit(1);
}

const REPO_NAME = process.env.GH_REPO || "Gia-Lifeflow";
const PRIVATE = process.argv.includes("--private");
const API = "https://api.github.com";
const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function gh(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  if (res.status === 204) return null;
  const body = await res.text();
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    json = body;
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${opts.method || "GET"} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return json;
}

// ---------- 1. Who am I? ----------
const me = await gh("/user");
console.log(`Authenticated as @${me.login}${me.name ? ` (${me.name})` : ""}`);

// ---------- 2. Repo exists? Create if not ----------
let repo;
try {
  repo = await gh(`/repos/${me.login}/${REPO_NAME}`);
  console.log(`Repo already exists: ${repo.html_url}`);
} catch {
  repo = await gh(`/user/repos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: REPO_NAME,
      description:
        "LifeFlow — your entire life, on one device. Dashboard, weather, mail, notes, diary, media, health, books, P2P encrypted chat, and more. Offline-first, no account, no cloud, no telemetry.",
      homepage: "",
      private: PRIVATE,
      has_issues: true,
      has_wiki: true,
      has_projects: false,
      auto_init: false,
    }),
  });
  console.log(`Created repo: ${repo.html_url}`);
}

// ---------- 2.5 Bootstrap an empty repo ----------
// GitHub refuses to create blobs on a repository with zero commits (409
// "Git Repository is empty"), so seed an empty root commit first.
const now = new Date();
const author = {
  name: me.name || me.login,
  email: `${me.id}+${me.login}@users.noreply.github.com`,
  date: now.toISOString(),
};

let parentSha = null;
try {
  const ref = await gh(`/repos/${me.login}/${REPO_NAME}/git/ref/heads/main`);
  parentSha = ref.object.sha;
} catch {
  // Zero-commit repos reject ALL Git Database API object creation (409
  // "Git Repository is empty"). The Contents API is the only endpoint that
  // implicitly creates the initial commit, so seed a tiny .gitkeep.
  await gh(`/repos/${me.login}/${REPO_NAME}/contents/.gitkeep`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "chore: initialize repository",
      content: Buffer.from("initialized by LifeFlow\n").toString("base64"),
    }),
  });
  const ref = await gh(`/repos/${me.login}/${REPO_NAME}/git/ref/heads/main`);
  parentSha = ref.object.sha;
  console.log(`Bootstrapped empty repo via .gitkeep (init commit ${parentSha.slice(0, 7)})`);
}

// ---------- 3. Collect files ----------
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  "convex",
  ".gradle",
  "build",
  ".cxx",
  ".idea",
  ".vscode",
]);
const SKIP_FILES = new Set([
  "package-lock.json",
  "integrations.md",
  "sst-env.d.ts",
  "main.ts",
  "vly-toolbar-readonly.tsx",
  "android/local.properties",
  "android/capacitor-cordova-android-plugins/build",
]);

function shouldSkip(rel) {
  const parts = rel.split(sep);
  // android/app/src/main/assets/public and similar generated dirs
  if (parts.includes("assets") && parts.includes("public")) return true;
  for (const p of parts) if (SKIP_DIRS.has(p)) return true;
  const base = parts[parts.length - 1];
  if (SKIP_FILES.has(base)) return true;
  // never push any .env file (local secrets)
  if (base.startsWith(".env")) return true;
  return false;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = relative(".", abs);
    if (shouldSkip(rel)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else out.push({ rel: rel.split(sep).join("/"), abs, size: st.size });
  }
  return out;
}

const files = walk(".");
files.sort((a, b) => a.rel.localeCompare(b.rel));
console.log(`Pushing ${files.length} files as a fresh commit on ${REPO_NAME}`);

// ---------- 4. Create blobs (concurrency 8) ----------
async function pool(items, worker, size = 8) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

const blobShas = await pool(files, async (f) => {
  const b64 = readFileSync(f.abs).toString("base64");
  const blob = await gh(`/repos/${me.login}/${REPO_NAME}/git/blobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: b64, encoding: "base64" }),
  });
  return { path: f.rel, sha: blob.sha };
});

// ---------- 5. Build the tree ----------
const tree = await gh(`/repos/${me.login}/${REPO_NAME}/git/trees`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    base_tree: null,
    tree: blobShas.map(({ path, sha }) => ({ path, mode: "100644", type: "blob", sha })),
  }),
});
console.log(`Tree created: ${tree.sha.slice(0, 7)}`);

// ---------- 6. Commit ----------
const DEFAULT_MESSAGE =
  "Initial commit: LifeFlow — private, offline-first life OS (web + Android APK)\n\nDashboard, weather, news, notes, diary, photos, voice, music, movies, books, health, mail (OAuth + app password), P2P encrypted chat, in-app browser, device-security lock. No account, no cloud, no telemetry.\n\nGenerated with Codebuff 🤖\nCo-Authored-By: Codebuff <noreply@codebuff.com>";

const commit = await gh(`/repos/${me.login}/${REPO_NAME}/git/commits`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: process.env.GH_MESSAGE || DEFAULT_MESSAGE,
    tree: tree.sha,
    parents: parentSha ? [parentSha] : [],
    author,
    committer: author,
  }),
});
console.log(`Commit created: ${commit.sha.slice(0, 7)} (parent: ${parentSha ? parentSha.slice(0, 7) : "none"})`);

// ---------- 7. Point main at it ----------
try {
  await gh(`/repos/${me.login}/${REPO_NAME}/git/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "refs/heads/main", sha: commit.sha }),
  });
  console.log("Branch refs/heads/main created.");
} catch {
  await gh(`/repos/${me.login}/${REPO_NAME}/git/refs/heads/main`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  console.log("Branch refs/heads/main updated (fast-forward).");
}

console.log(`\nDone. Repo: ${repo.html_url}`);
console.log(`Commit: https://github.com/${me.login}/${REPO_NAME}/commit/${commit.sha}`);
console.log("GitHub Actions will pick up the push automatically (workflow in .github/workflows/).");
