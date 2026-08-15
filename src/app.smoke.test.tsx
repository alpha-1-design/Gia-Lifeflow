/**
 * Full-app smoke test.
 *
 * Mounts the app shell and every route and asserts each renders without
 * throwing. This catches the class of bug a typecheck can't: a page that blows
 * up at runtime (missing provider, bad hook order, an undefined browser API).
 */
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

// pdfjs-dist pulls the ES2024 `Iterator` global (Node 22+) at import time and
// is only exercised when an actual PDF is opened. Stub it so the Reader page
// can mount its "book not found" state without that dependency.
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => {
    throw new Error("pdfjs is not available in tests");
  },
}));

import AppShell from "@/components/AppShell";
import Dashboard from "@/pages/app/Dashboard";
import Notes from "@/pages/app/Notes";
import Diary from "@/pages/app/Diary";
import Photos from "@/pages/app/Photos";
import Voice from "@/pages/app/Voice";
import Music from "@/pages/app/Music";
import Movies from "@/pages/app/Movies";
import Books from "@/pages/app/Books";
import Reader from "@/pages/app/Reader";
import Health from "@/pages/app/Health";
import Focus from "@/pages/app/Focus";
import Finance from "@/pages/app/Finance";
import Habits from "@/pages/app/Habits";
import Companion from "@/pages/app/Companion";
import Mail from "@/pages/app/Mail";
import Chat from "@/pages/app/Chat";
import Browser from "@/pages/app/Browser";
import Settings from "@/pages/app/Settings";
import Landing from "@/pages/Landing";
import NotFound from "@/pages/NotFound";

const THEME = { attribute: "class", defaultTheme: "dark", enableSystem: false } as const;

/** Render a single component inside the providers the app itself uses. */
function renderAt(ui: ReactElement, path: string) {
  return render(
    <ThemeProvider {...THEME}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </ThemeProvider>,
  );
}

const PAGES: { name: string; path: string; ui: ReactElement }[] = [
  { name: "Landing", path: "/", ui: <Landing /> },
  { name: "NotFound", path: "/does-not-exist", ui: <NotFound /> },
  { name: "Dashboard", path: "/app/dashboard", ui: <Dashboard /> },
  { name: "Companion", path: "/app/companion", ui: <Companion /> },
  { name: "Notes", path: "/app/notes", ui: <Notes /> },
  { name: "Diary", path: "/app/diary", ui: <Diary /> },
  { name: "Photos", path: "/app/photos", ui: <Photos /> },
  { name: "Voice", path: "/app/voice", ui: <Voice /> },
  { name: "Music", path: "/app/music", ui: <Music /> },
  { name: "Movies", path: "/app/movies", ui: <Movies /> },
  { name: "Books", path: "/app/books", ui: <Books /> },
  { name: "Reader", path: "/app/books/missing", ui: <Reader /> },
  { name: "Health", path: "/app/health", ui: <Health /> },
  { name: "Focus", path: "/app/focus", ui: <Focus /> },
  { name: "Finance", path: "/app/finance", ui: <Finance /> },
  { name: "Habits", path: "/app/habits", ui: <Habits /> },
  { name: "Mail", path: "/app/mail", ui: <Mail /> },
  { name: "Chat", path: "/app/chat", ui: <Chat /> },
  { name: "Browser", path: "/app/browser", ui: <Browser /> },
  { name: "Settings", path: "/app/settings", ui: <Settings /> },
];

describe("Lifeflow smoke test", () => {
  it("mounts the app shell with every navigation module", async () => {
    render(
      <ThemeProvider {...THEME}>
        <MemoryRouter initialEntries={["/app/dashboard"]}>
          <Routes>
            <Route path="/app" element={<AppShell />}>
              <Route path="dashboard" element={<Dashboard />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );

    // Wait for the shell to finish booting (settings read) and render the nav.
    expect(await screen.findByText("Companion")).toBeTruthy();

    const modules = [
      "Dashboard",
      "Notes",
      "Diary",
      "Photos",
      "Voice",
      "Music",
      "Movies",
      "Books",
      "Health",
      "Focus",
      "Finance",
      "Habits",
      "Mail",
      "Chat",
      "Browser",
    ];
    for (const label of modules) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("toggles the sidebar collapse and the theme from the shell", async () => {
    render(
      <ThemeProvider {...THEME}>
        <MemoryRouter initialEntries={["/app/dashboard"]}>
          <Routes>
            <Route path="/app" element={<AppShell />}>
              <Route path="dashboard" element={<Dashboard />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );

    await screen.findByText("Companion");

    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
    fireEvent.click(collapse);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();

    const theme = screen.getByRole("button", { name: "Toggle theme" });
    fireEvent.click(theme);
    // Clicking toggles theme; the button must still be present afterwards.
    expect(screen.getByRole("button", { name: "Toggle theme" })).toBeTruthy();
  });

  it("renders the Companion input and suggestions", () => {
    renderAt(<Companion />, "/app/companion");
    expect(screen.getByPlaceholderText(/Ask anything|Offline/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    for (const s of ["Summarize my week", "Plan tomorrow for me"]) {
      expect(screen.getByText(s)).toBeTruthy();
    }
  });

  it("renders the Browser with an address/search bar", () => {
    renderAt(<Browser />, "/app/browser");
    expect(screen.getByPlaceholderText(/Search or enter address/i)).toBeTruthy();
  });

  it("renders Settings with the AI companion and Exa sections", async () => {
    renderAt(<Settings />, "/app/settings");
    expect(await screen.findByText("AI companion")).toBeTruthy();
    expect(screen.getByText("Exa web-search key")).toBeTruthy();
    expect(screen.getByText("Encrypted backup")).toBeTruthy();
  });

  for (const page of PAGES) {
    it(`renders ${page.name} without crashing`, () => {
      const { container } = renderAt(page.ui, page.path);
      expect(container.textContent?.trim().length).toBeGreaterThan(0);
    });
  }
});
