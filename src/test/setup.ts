/**
 * Global test setup: run in jsdom for the component smoke tests.
 *
 * jsdom ships without IndexedDB, matchMedia, object URLs, ResizeObserver and a
 * few other APIs the app relies on. This file installs minimal shims so every
 * page can mount the same way it does in a real browser.
 */
import "fake-indexeddb/auto";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

/* --------------------- browser APIs jsdom doesn't ship --------------------- */

// matchMedia — used by next-themes and the use-mobile hook.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// URL.createObjectURL / revokeObjectURL — media, images, backups and exports.
if (typeof URL.createObjectURL !== "function") {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => `blob:mock-${Math.random().toString(36).slice(2)}`,
  });
}
if (typeof URL.revokeObjectURL !== "function") {
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => {},
  });
}

// scrollIntoView / scrollTo — jsdom doesn't implement either.
if (typeof window !== "undefined" && window.HTMLElement && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}
if (typeof window !== "undefined" && typeof window.scrollTo !== "function") {
  window.scrollTo = () => {};
}

// ResizeObserver — react-resizable-panels and several shadcn primitives.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
}

// IntersectionObserver — react-intersection-observer.
if (typeof globalThis.IntersectionObserver === "undefined") {
  class IntersectionObserverMock {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds = [0];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  globalThis.IntersectionObserver =
    IntersectionObserverMock as unknown as typeof IntersectionObserver;
}

// WebRTC — the Chat page builds peer connections when a call starts.
if (typeof globalThis.RTCPeerConnection === "undefined") {
  globalThis.RTCPeerConnection = class {} as unknown as typeof RTCPeerConnection;
}
