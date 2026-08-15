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
    // MUST stay false: several modules (AI companion streaming in ai.ts,
    // the accelerated Range-request downloader in downloader.ts) read
    // res.body.getReader() directly. CapacitorHttp buffers the whole
    // response through a native bridge and breaks both — streaming silently
    // stops working and downloads fail with "No response body". Cross-origin
    // fetches that need it already have their own CORS-relay fallback
    // (api.allorigins.win) built into downloader.ts/clients.ts/freelibrary.ts.
    CapacitorHttp: {
      enabled: false,
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
      // overlaysWebView is set at runtime in main.tsx (needs the plugin
      // call, not just config) so the WebView content is pushed below the
      // status bar instead of drawing under it on edge-to-edge Android.
      style: "dark",
      backgroundColor: "#0f172a",
      overlaysWebView: false,
    },
    Viewport: {
      fullscreen: false,
      metadata: "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\">",
    },
  },
};

export default config;
