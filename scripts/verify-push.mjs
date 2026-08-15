#!/usr/bin/env node
/**
 * verify-push.mjs — Check what actually landed in the GitHub repo.
 * Usage: GH_TOKEN=<token> node scripts/verify-push.mjs <commit-sha>
 */
const TOKEN = process.env.GH_TOKEN;
const OWNER = process.env.GH_OWNER || "alpha-1-design";
const REPO = process.env.GH_REPO || "Gia-Lifeflow";
const SHA = process.argv[2];
if (!TOKEN || !SHA) {
  console.error("Usage: GH_TOKEN=<token> node scripts/verify-push.mjs <commit-sha>");
  process.exit(1);
}

const res = await fetch(
  `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${SHA}?recursive=1`,
  { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json" } },
);
const data = await res.json();
if (!res.ok) {
  console.error(res.status, JSON.stringify(data).slice(0, 300));
  process.exit(1);
}
const paths = data.tree.filter((t) => t.type === "blob").map((t) => t.path);
console.log("total files in commit:", paths.length);

// Things that must NOT be in the repo
const forbidden = [".env", "node_modules/", "dist/", "integrations.md", "/main.ts", "sst-env", "vly-toolbar", ".gitkeep"];
const bad = paths.filter((p) => forbidden.some((f) => p.includes(f)));
console.log("forbidden entries found:", bad.length ? bad : "none");

// Things that MUST be in the repo
const required = [
  "package.json",
  "package-lock.json",
  "README.md",
  "capacitor.config.ts",
  "index.html",
  "src/main.tsx",
  ".github/workflows/build-apk.yml",
  "android/app/build.gradle",
  "android/app/src/main/AndroidManifest.xml",
  "android/app/src/main/java/com/lifeflow/app/MailBridgePlugin.java",
  "android/app/src/main/java/com/lifeflow/app/MainActivity.java",
  "scripts/publish.mjs",
  "src/lib/db.ts",
  "src/lib/crypto.ts",
  "src/pages/app/Dashboard.tsx",
  "src/pages/app/Mail.tsx",
];
const missing = required.filter((r) => !paths.includes(r));
console.log("missing required files:", missing.length ? missing : "none");

const wf = paths.find((p) => p.includes("build-apk"));
console.log("workflow file:", wf || "MISSING");
