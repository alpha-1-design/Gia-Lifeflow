import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import React, { lazy, Suspense, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import "./index.css";

/**
 * The preview toolbar is injected by the hosting platform and only exists in
 * this workspace — it is not part of the public repo or the APK build. Load it
 * lazily through a runtime variable so neither `tsc` nor `vite build` tries to
 * resolve it; if the file is missing (GitHub Actions, APK) the import rejects
 * and the toolbar simply renders nothing.
 */
const vlyToolbarSpec = "../vly-toolbar-readonly.tsx";
const VlyToolbar = lazy(() =>
  import(/* @vite-ignore */ vlyToolbarSpec).catch(() => ({ default: () => null })),
);

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AppShell = lazy(() => import("./components/AppShell.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

const Dashboard = lazy(() => import("./pages/app/Dashboard.tsx"));
const Notes = lazy(() => import("./pages/app/Notes.tsx"));
const Diary = lazy(() => import("./pages/app/Diary.tsx"));
const Photos = lazy(() => import("./pages/app/Photos.tsx"));
const Voice = lazy(() => import("./pages/app/Voice.tsx"));
const Music = lazy(() => import("./pages/app/Music.tsx"));
const Movies = lazy(() => import("./pages/app/Movies.tsx"));
const Books = lazy(() => import("./pages/app/Books.tsx"));
const Reader = lazy(() => import("./pages/app/Reader.tsx"));
const Health = lazy(() => import("./pages/app/Health.tsx"));
const Focus = lazy(() => import("./pages/app/Focus.tsx"));
const Finance = lazy(() => import("./pages/app/Finance.tsx"));
const Habits = lazy(() => import("./pages/app/Habits.tsx"));
const Companion = lazy(() => import("./pages/app/Companion.tsx"));
const Mail = lazy(() => import("./pages/app/Mail.tsx"));
const Chat = lazy(() => import("./pages/app/Chat.tsx"));
const Browser = lazy(() => import("./pages/app/Browser.tsx"));
const Settings = lazy(() => import("./pages/app/Settings.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="animate-pulse font-mono text-xs tracking-widest text-muted-foreground uppercase">
        Lifeflow
      </div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs break-words text-muted-foreground">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 max-h-40 overflow-auto rounded border border-border/60 p-2 text-left text-[10px] leading-4 text-muted-foreground/80">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <Suspense fallback={null}>
          <VlyToolbar />
        </Suspense>
      </ToolbarErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/app" element={<AppShell />}>
                <Route index element={<Navigate to="/app/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="notes" element={<Notes />} />
                <Route path="diary" element={<Diary />} />
                <Route path="photos" element={<Photos />} />
                <Route path="voice" element={<Voice />} />
                <Route path="music" element={<Music />} />
                <Route path="movies" element={<Movies />} />
                <Route path="books" element={<Books />} />
                <Route path="books/:id" element={<Reader />} />
                <Route path="health" element={<Health />} />
                <Route path="focus" element={<Focus />} />
                <Route path="finance" element={<Finance />} />
                <Route path="habits" element={<Habits />} />
                <Route path="companion" element={<Companion />} />
                <Route path="mail" element={<Mail />} />
                <Route path="chat" element={<Chat />} />
                <Route path="browser" element={<Browser />} />
                <Route path="settings" element={<Settings />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ThemeProvider>
    </RootErrorBoundary>
  </React.StrictMode>,
);
