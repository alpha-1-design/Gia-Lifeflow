import { openDB, type IDBPDatabase } from "idb";
import { useEffect, useState } from "react";

/**
 * Lifeflow local database.
 *
 * Everything lives in IndexedDB on this device — there is no server, no
 * account, no sync. `put`/`remove`/`clear` notify subscribers so React hooks
 * (`useCollection`, `useSetting`) re-render automatically.
 */

export const DB_NAME = "lifeflow";

const STORES = [
  "settings", // { key, value }
  "blobs", // { id, blob: Blob, type }
  "notes", // Note
  "diary", // DiaryEntry
  "photos", // Photo
  "voice", // VoiceNote
  "music", // Track
  "movies", // Movie
  "books", // Book
  "health", // HealthEntry
  "chats", // Chat
  "messages", // Message
  "downloads", // DownloadTask
  "chunks", // { id: `${dlId}:${idx}`, blob }
  "cache", // { key, value, ts }
  "emails", // EmailItem
  "browser", // BrowserEntry
] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBPDatabase> | null = null;
export function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        for (const s of STORES) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
        }
      },
    });
  }
  return dbPromise;
}

/* ----------------------------- types ----------------------------------- */

export interface Profile {
  name: string;
  bio: string;
  avatarBlobId?: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  photos: string[];
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DiaryEntry {
  id: string;
  date: string; // YYYY-MM-DD
  mood: string;
  content: string;
  photos: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Photo {
  id: string;
  blobId: string;
  caption: string;
  createdAt: number;
}

export interface VoiceNote {
  id: string;
  blobId: string;
  title: string;
  duration: number;
  createdAt: number;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  blobId: string;
  duration: number;
  coverBlobId?: string;
  createdAt: number;
  source: "device" | "url";
}

export interface Movie {
  id: string;
  title: string;
  blobId: string;
  posterBlobId?: string;
  duration: number;
  createdAt: number;
  source: "device" | "url";
  progress: number; // seconds
}

export interface Book {
  id: string;
  title: string;
  author: string;
  kind: "epub" | "pdf" | "txt";
  blobId: string;
  progress: string; // epub: cfi, pdf: page, txt: ratio
  createdAt: number;
}

export type HealthType = "meal" | "exercise" | "sleep" | "water" | "weight";

export interface HealthEntry {
  id: string;
  date: string; // YYYY-MM-DD
  type: HealthType;
  data: Record<string, number | string>;
  createdAt: number;
}

export interface Chat {
  id: string;
  name: string;
  createdAt: number;
  lastMessage?: string;
  peer?: string;
}

export interface Message {
  id: string;
  chatId: string;
  direction: "sent" | "received";
  text: string;
  img?: string; // data URL, kept small
  ts: number;
  status: "pending" | "sent" | "delivered" | "failed";
}

export interface DownloadTask {
  id: string;
  url: string;
  kind: "music" | "movie" | "book";
  title: string;
  total: number; // bytes
  progress: number; // 0..1
  status: "queued" | "downloading" | "done" | "error" | "canceled";
  createdAt: number;
  blobId?: string;
  error?: string;
}

export interface CacheEntry {
  key: string;
  value: unknown;
  ts: number;
}

export interface EmailItem {
  id: string;
  from: string;
  fromName: string;
  subject: string;
  date: number;
  snippet: string;
  body: string;
  read: boolean;
  account: string;
}

export interface BrowserEntry {
  id: string;
  url: string;
  title: string;
  pinned: boolean;
  visitedAt: number;
}

/* --------------------------- reactive store ---------------------------- */

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((fn) => fn());
}
export function subscribeDb(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const d = await db();
  return (await d.getAll(store)) as T[];
}

export async function getOne<T>(store: StoreName, key: string): Promise<T | undefined> {
  const d = await db();
  return (await d.get(store, key)) as T | undefined;
}

export async function put<T>(store: StoreName, value: T): Promise<void> {
  const d = await db();
  await d.put(store, value);
  notify();
}

export async function remove(store: StoreName, key: string): Promise<void> {
  const d = await db();
  await d.delete(store, key);
  notify();
}

export async function clearStore(store: StoreName): Promise<void> {
  const d = await db();
  await d.clear(store);
  notify();
}

/* ------------------------------ settings ------------------------------- */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const d = await db();
  const row = await d.get("settings", key);
  return (row?.value as T | undefined) ?? fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const d = await db();
  await d.put("settings", { key, value });
  notify();
}

export async function removeSetting(key: string): Promise<void> {
  const d = await db();
  await d.delete("settings", key);
  notify();
}

/* ------------------------------- blobs --------------------------------- */

export async function saveBlob(blob: Blob, type?: string): Promise<string> {
  const id = crypto.randomUUID();
  const d = await db();
  await d.put("blobs", { id, blob, type });
  notify();
  return id;
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const d = await db();
  const row = await d.get("blobs", id);
  return row?.blob as Blob | undefined;
}

export async function deleteBlob(id: string): Promise<void> {
  const d = await db();
  await d.delete("blobs", id);
  notify();
}

/** Create an object URL for a stored blob. Caller must revoke it. */
export async function blobUrl(id: string): Promise<string | null> {
  const blob = await getBlob(id);
  return blob ? URL.createObjectURL(blob) : null;
}

export async function getStorageUsage(): Promise<number> {
  const d = await db();
  const blobs = (await d.getAll("blobs")) as { blob: Blob }[];
  return blobs.reduce((sum, b) => sum + b.blob.size, 0);
}

/* ------------------------------- hooks --------------------------------- */

export function useCollection<T>(store: StoreName): T[] {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      getAll<T>(store).then((v) => {
        if (alive) setItems(v);
      });
    load();
    const unsub = subscribeDb(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [store]);
  return items;
}

export function useSetting<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    let alive = true;
    const load = () =>
      getSetting<T>(key, fallback).then((v) => {
        if (alive) setValue(v);
      });
    load();
    const unsub = subscribeDb(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [key, fallback]);
  return [
    value,
    (v: T) => {
      setSetting(key, v);
    },
  ];
}
