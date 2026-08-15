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
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    Camera: {
      permissions: ["camera", "read_media_images"],
    },
    FilePicker: {
      permissions: ["read_media_images", "read_media_video", "read_media_audio"],
    },
    SplashScreen: {
      launchShowDuration: 1000,
      backgroundColor: "#0f172a",
      showSpinner: false,
    },
    StatusBar: {
      style: "dark",
      backgroundColor: "#0f172a",
    },
    Viewport: {
      fullscreen: false,
      metadata: "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\">",
    },
  },
};

export default config;
