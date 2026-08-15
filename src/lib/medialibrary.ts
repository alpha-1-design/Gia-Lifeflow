import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * On-device media library (Android only).
 *
 * The native `MediaLibraryPlugin` scans MediaStore for music and video that is
 * already on the device, and can copy a chosen file into the app's private
 * cache so it plays offline through the same blob storage as every other file.
 * In the browser build this module is inert: browsers can't scan the
 * filesystem, so the Import buttons use the system file picker instead.
 */

export interface LibraryItem {
  id: string;
  name: string;
  duration: number; // seconds
  size: number; // bytes
  mime: string;
  artist: string;
  album: string;
  uri: string;
}

interface MediaLibraryPlugin {
  scan(opts: { kind: "audio" | "video" }): Promise<{ items: LibraryItem[] }>;
  copyToApp(opts: { uri: string; name: string }): Promise<{ path: string }>;
}

const MediaLibrary = registerPlugin<MediaLibraryPlugin>("MediaLibrary");

export function isMediaLibraryAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/** Lists the device's audio or video library, newest first. */
export async function scanLibrary(kind: "audio" | "video"): Promise<LibraryItem[]> {
  if (!isMediaLibraryAvailable()) return [];
  const res = await MediaLibrary.scan({ kind });
  return res.items ?? [];
}

/**
 * Copies a MediaStore file into the app cache and returns a URL the WebView
 * can fetch (so it can be read into a blob and stored with the rest of the
 * library). Returns null on the web or on failure.
 */
export async function importLibraryItem(item: LibraryItem): Promise<string | null> {
  if (!isMediaLibraryAvailable()) return null;
  const res = await MediaLibrary.copyToApp({ uri: item.uri, name: item.name });
  if (!res?.path) return null;
  return Capacitor.convertFileSrc(res.path);
}
