/**
 * Lifeflow native mail bridge.
 *
 * A Google app password is a 16-character passcode that only works over
 * IMAP/SMTP — protocols that need raw TCP, which browsers cannot open. So in
 * the native Android build, Mail talks to Gmail's IMAP (read) and SMTP (send)
 * through a small JavaMail plugin (`MailBridgePlugin`) with the app password.
 *
 * In the browser build this module is inert: the app uses Gmail's REST API
 * with OAuth instead (see `./gmail.ts`). The app password itself is kept in
 * the Android Keystore on native builds, and in IndexedDB on web.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";

export interface NativeMailMessage {
  id: string;
  from: string;
  subject: string;
  date: number;
  snippet: string;
  body: string;
}

interface MailBridgePlugin {
  send(opts: {
    host: string;
    port: number;
    user: string;
    pass: string;
    to: string;
    subject: string;
    body: string;
  }): Promise<{ ok: boolean }>;
  fetchInbox(opts: {
    host: string;
    port: number;
    user: string;
    pass: string;
    max: number;
  }): Promise<{ count: number; messages: NativeMailMessage[] }>;
}

const MailBridge = registerPlugin<MailBridgePlugin>("MailBridge");

const IMAP_HOST = "imap.gmail.com";
const IMAP_PORT = 993;
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;

/** Namespace for app-password credentials inside the Android Keystore. */
const CRED_SERVER = "lifeflow-gmail";

/** Whether the native mail bridge is available (native APK only). */
export function isMailBridgeAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/** Stores the app-password credentials in the Android Keystore. */
export async function storeNativeCredentials(email: string, appPassword: string): Promise<void> {
  if (!isMailBridgeAvailable()) return;
  await NativeBiometric.setCredentials({ username: email, password: appPassword, server: CRED_SERVER });
}

/** Reads app-password credentials back from the Android Keystore. */
export async function readNativeCredentials(): Promise<{ email: string; appPassword: string } | null> {
  if (!isMailBridgeAvailable()) return null;
  try {
    const creds = await NativeBiometric.getCredentials({ server: CRED_SERVER });
    if (!creds?.username || !creds?.password) return null;
    return { email: creds.username, appPassword: creds.password };
  } catch {
    return null;
  }
}

/** Removes stored app-password credentials from the Android Keystore. */
export async function clearNativeCredentials(): Promise<void> {
  if (!isMailBridgeAvailable()) return;
  try {
    await NativeBiometric.deleteCredentials({ server: CRED_SERVER });
  } catch {
    /* already gone */
  }
}

/** Fetches the newest `max` messages from the inbox over IMAP. */
export async function nativeFetchInbox(email: string, appPassword: string, max = 20): Promise<NativeMailMessage[]> {
  if (!isMailBridgeAvailable()) throw new Error("App-password mail needs the native app (APK)");
  const res = await MailBridge.fetchInbox({
    host: IMAP_HOST,
    port: IMAP_PORT,
    user: email,
    pass: appPassword,
    max,
  });
  return (res.messages ?? []).sort((a, b) => b.date - a.date);
}

/** Sends an email over Gmail SMTP with the app password. */
export async function nativeSendEmail(
  email: string,
  appPassword: string,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  if (!isMailBridgeAvailable()) throw new Error("App-password mail needs the native app (APK)");
  await MailBridge.send({
    host: SMTP_HOST,
    port: SMTP_PORT,
    user: email,
    pass: appPassword,
    to,
    subject,
    body,
  });
}

/** Validates an app password by fetching a single message. */
export async function testAppPassword(email: string, appPassword: string): Promise<boolean> {
  try {
    const msgs = await nativeFetchInbox(email, appPassword, 1);
    return Array.isArray(msgs);
  } catch {
    return false;
  }
}
