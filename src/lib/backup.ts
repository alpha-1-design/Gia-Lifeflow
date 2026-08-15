/**
 * Encrypted backups — export everything to a single passphrase-protected
 * file, and restore it on this device or a new one.
 *
 * Crypto is Web Crypto: PBKDF2-SHA256 (250k iterations) derives an AES-256-GCM
 * key from your passphrase. The key is never stored; without the passphrase
 * the file is unreadable. Everything happens on-device.
 */
import { db, type StoreName } from "./db";
import { todayKey } from "./format";

const MAGIC = "LIFEFLOW-BACKUP";
const PBKDF2_ITERATIONS = 250_000;
const DEFAULT_MAX_MEDIA = 250 * 1024 * 1024; // embed media blobs up to ~250 MB

const STORES: StoreName[] = [
  "settings",
  "notes",
  "diary",
  "photos",
  "voice",
  "music",
  "movies",
  "books",
  "health",
  "chats",
  "messages",
  "downloads",
  "emails",
  "browser",
  "aiChat",
  "playlists",
  "focus",
  "transactions",
  "budgets",
  "habits",
  "habitLogs",
  "places",
];

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer as ArrayBuffer;
}

async function deriveKey(passphrase: string, salt: BufferSource): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface ExportResult {
  filename: string;
  size: number;
  embeddedBlobs: number;
  skippedBlobs: number;
}

/**
 * Export every store (plus media blobs when requested and small enough) into
 * one encrypted `.lfb` file and trigger a download.
 */
export async function exportEncrypted(passphrase: string, includeMedia: boolean): Promise<ExportResult> {
  if (!passphrase || passphrase.length < 4) throw new Error("Use a passphrase of at least 4 characters");

  const d = await db();
  const payload: Record<string, unknown> = {};

  for (const s of STORES) {
    if (s === "settings") {
      const rows = (await d.getAll("settings")) as { key: string; value: unknown }[];
      // Device-bound secrets (WebAuthn/biometric lock) must not travel.
      payload.settings = rows.filter((r) => r.key !== "security");
    } else {
      payload[s] = await d.getAll(s);
    }
  }

  const blobs = (await d.getAll("blobs")) as { id: string; type?: string; blob: Blob }[];
  const total = blobs.reduce((sum, b) => sum + b.blob.size, 0);
  const embed = includeMedia && total <= DEFAULT_MAX_MEDIA;
  const blobOut: Record<string, { type?: string; size: number; data?: string }> = {};
  let embedded = 0;
  let skipped = 0;
  for (const b of blobs) {
    if (embed) {
      const buf = await b.blob.arrayBuffer();
      blobOut[b.id] = { type: b.type, size: b.blob.size, data: toBase64(new Uint8Array(buf)) };
      embedded++;
    } else {
      skipped++;
      blobOut[b.id] = { type: b.type, size: b.blob.size };
    }
  }
  payload.blobs = blobOut;
  payload._meta = { exportedAt: new Date().toISOString(), app: "lifeflow", version: 1 };

  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));

  const file = JSON.stringify({
    magic: MAGIC,
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(cipher),
  });

  const filename = `lifeflow-backup-${todayKey()}.lfb`;
  const blob = new Blob([file], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);

  return { filename, size: blob.size, embeddedBlobs: embedded, skippedBlobs: skipped };
}

export interface RestoreResult {
  restored: string[];
  blobsRestored: number;
}

/** Read an encrypted `.lfb` file and replace the current data with it. */
export async function restoreFromFile(file: File, passphrase: string): Promise<RestoreResult> {
  const parsed = JSON.parse(await file.text()) as { magic?: string; salt?: string; iv?: string; data?: string };
  if (parsed.magic !== MAGIC || !parsed.salt || !parsed.iv || !parsed.data) {
    throw new Error("This does not look like a Lifeflow backup file");
  }
  const key = await deriveKey(passphrase, fromBase64(parsed.salt));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(parsed.iv) },
    key,
    fromBase64(parsed.data),
  );
  const payload = JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;

  const d = await db();
  const restored: string[] = [];
  let blobsRestored = 0;

  for (const [store, rows] of Object.entries(payload)) {
    if (store === "_meta" || store === "blobs") continue;
    if (!d.objectStoreNames.contains(store)) continue;
    await d.clear(store as StoreName);
    for (const row of (rows as unknown[]) ?? []) await d.put(store as StoreName, row);
    restored.push(store);
  }

  const blobMap = payload.blobs as Record<string, { type?: string; size?: number; data?: string }> | undefined;
  if (blobMap) {
    await d.clear("blobs");
    for (const [id, meta] of Object.entries(blobMap)) {
      if (meta.data) {
        const bytes = fromBase64(meta.data);
        await d.put("blobs", { id, type: meta.type, blob: new Blob([bytes], { type: meta.type }) });
        blobsRestored++;
      }
    }
  }

  return { restored, blobsRestored };
}
