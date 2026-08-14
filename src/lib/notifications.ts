import { getSetting, setSetting, getAll } from "./db";
import { todayKey } from "./format";

/**
 * Notifications — the browser Notification API. Lifeflow never sends
 * notifications through any server; they are composed and fired on-device.
 */

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const p = await Notification.requestPermission();
    return p === "granted";
  } catch {
    return false;
  }
}

export function notify(title: string, body?: string): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/logo.svg", tag: title });
  } catch {
    /* older browsers may throw — ignore */
  }
}

export function testNotification(): void {
  notify("Lifeflow", "Notifications are working. This was generated on your device.");
}

/**
 * The daily briefing — a single notification assembled from on-device data
 * (plus cached live info when available). Fires once per day at the chosen
 * time while the app is open.
 */
export async function maybeSendBriefing(): Promise<void> {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const prefs = await getSetting<{ enabled: boolean; briefingTime: string }>(
    "notifications",
    { enabled: false, briefingTime: "08:00" },
  );
  if (!prefs.enabled) return;

  const now = new Date();
  const [h, m] = prefs.briefingTime.split(":").map(Number);
  if (now.getHours() !== h || now.getMinutes() !== m) return;

  const fired = await getSetting<string>("briefingFired", "");
  if (fired === todayKey()) return;
  await setSetting("briefingFired", todayKey());

  const profile = await getSetting<{ name: string }>("profile", { name: "" });
  const emailPrefs = await getSetting<{ email: string }>("google", { email: "" });
  const emails = await getAll<{ read: boolean }>("emails");
  const notes = await getAll("notes");
  const diary = await getAll("diary");
  const health = await getAll<{ type: string; data: Record<string, number> }>("health");
  const music = await getAll("music");
  const movies = await getAll("movies");
  const books = await getAll("books");

  const parts: string[] = [];
  const unread = emails.filter((e) => !e.read).length;
  if (emailPrefs.email && unread > 0) parts.push(`${unread} unread email${unread > 1 ? "s" : ""}`);
  if (notes.length > 0) parts.push(`${notes.length} note${notes.length > 1 ? "s" : ""}`);
  if (diary.length > 0) parts.push(`${diary.length} journal entr${diary.length > 1 ? "ies" : "y"}`);
  const lastSleep = health
    .filter((x) => x.type === "sleep")
    .sort((a, b) => (a.data.start as number) - (b.data.start as number))
    .pop();
  if (lastSleep) {
    const hours = ((lastSleep.data.duration as number) / 3600).toFixed(1);
    parts.push(`slept ${hours}h last night`);
  }
  if (music.length + movies.length + books.length > 0) {
    parts.push(`${music.length} songs · ${movies.length} films · ${books.length} books on device`);
  }

  const greet = profile.name ? `Good ${now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"}, ${profile.name}.` : "Good day.";
  notify(
    "Your briefing",
    parts.length > 0 ? `${greet} ${parts.join(" · ")}.` : `${greet} Everything is stored privately on this device.`,
  );
}
