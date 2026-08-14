import { describe, expect, it } from "bun:test";
import { clamp, extOf, filenameFromUrl, fmtBytes, fmtDuration, initialsOf, todayKey } from "./format";

describe("todayKey", () => {
  it("zero-pads month and day", () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(todayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("fmtDuration", () => {
  it("formats minutes and seconds", () => {
    expect(fmtDuration(0)).toBe("0:00");
    expect(fmtDuration(65)).toBe("1:05");
    expect(fmtDuration(3723)).toBe("1:02:03");
  });
  it("handles invalid input", () => {
    expect(fmtDuration(Number.NaN)).toBe("0:00");
    expect(fmtDuration(-5)).toBe("0:00");
  });
});

describe("fmtBytes", () => {
  it("formats sizes with units", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(2048)).toBe("2.0 KB");
    expect(fmtBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("clamp", () => {
  it("clamps into range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("initialsOf", () => {
  it("takes the first letter of up to two words", () => {
    expect(initialsOf("Life Flow")).toBe("LF");
    expect(initialsOf("LifeFlow")).toBe("L");
    expect(initialsOf("a")).toBe("A");
    expect(initialsOf("   ")).toBe("LF");
  });
});

describe("filenameFromUrl", () => {
  it("extracts the basename without extension", () => {
    expect(filenameFromUrl("https://cdn.example.com/songs/never-gonna-give.mp3")).toBe("never-gonna-give");
  });
  it("falls back to the last path segment, then the hostname (TLD stripped)", () => {
    expect(filenameFromUrl("https://example.com/folder/")).toBe("folder");
    expect(filenameFromUrl("https://example.com/")).toBe("example");
  });
});

describe("extOf", () => {
  it("returns the lowercase extension", () => {
    expect(extOf("https://x.com/a.MP4")).toBe("mp4");
    expect(extOf("https://x.com/archive.tar.gz")).toBe("gz");
  });
  it("returns empty when there is no extension", () => {
    expect(extOf("https://x.com/nothing")).toBe("");
    expect(extOf("https://x.com/folder/")).toBe("");
    expect(extOf("not a url")).toBe("");
  });
});
