import { describe, expect, it } from "vitest";
import { exaResultsToContext, type ExaResult } from "./exa";

describe("exaResultsToContext", () => {
  it("renders numbered results with url, date and excerpt", () => {
    const results: ExaResult[] = [
      { title: "Example", url: "https://example.com", text: "Hello world" },
      {
        title: "Second",
        url: "https://two.dev",
        text: "",
        publishedDate: "2024-01-02T00:00:00.000Z",
        author: "Jane",
      },
    ];
    const ctx = exaResultsToContext(results);
    expect(ctx).toContain("[1] Example");
    expect(ctx).toContain("https://example.com");
    expect(ctx).toContain("Hello world");
    expect(ctx).toContain("[2] Second by Jane (2024-01-02)");
    expect(ctx).toContain("(no excerpt)");
  });

  it("handles empty results", () => {
    expect(exaResultsToContext([])).toBe("No web results.");
  });

  it("truncates long excerpts", () => {
    const ctx = exaResultsToContext([
      { title: "T", url: "https://x.dev", text: "a".repeat(1000) },
    ]);
    expect(ctx).toContain("…");
    expect(ctx.length).toBeLessThan(700);
  });
});
