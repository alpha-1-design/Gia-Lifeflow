import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Lifeflow — Capacitor config.
 *
 * The web app builds to `dist/` (Vite) and Capacitor wraps it as a native
 * Android app. The app is local-first: all data lives in IndexedDB on the
 * device, exactly as it does in the browser build.
 */
const config: CapacitorConfig = {
  appId: "com.lifeflow.app",
  appName: "Lifeflow",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
