import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Component smoke tests need a DOM, so run under jsdom with a setup file that
// shims the browser APIs jsdom doesn't provide (IndexedDB, matchMedia, etc.).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      // The default "forks" pool require()s jsdom's css-color dependency as
      // CJS, which trips ERR_REQUIRE_ESM on Node 20. Threads load ESM entries.
      pool: "threads",
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  }),
);
