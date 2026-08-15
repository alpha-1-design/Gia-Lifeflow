import { describe, expect, it } from "vitest";
import { filenameFromDisposition, relayUrl } from "./downloader";

describe("filenameFromDisposition", () => {
  it("parses a quoted filename", () => {
    expect(filenameFromDisposition('attachment; filename="track.mp3"')).toBe("track.mp3");
  });
  it("parses an unquoted filename", () => {
    expect(filenameFromDisposition("attachment; filename=video.mp4")).toBe("video.mp4");
  });
  it("decodes a UTF-8 filename*", () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''caf%C3%A9.mp3")).toBe("café.mp3");
  });
  it("returns null when no filename is present", () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition("attachment")).toBeNull();
  });
});

describe("relayUrl", () => {
  it("wraps a URL in the public CORS relay", () => {
    expect(relayUrl("https://example.com/a b.mp3")).toBe(
      "https://api.allorigins.win/raw?url=https%3A%2F%2Fexample.com%2Fa%20b.mp3",
    );
  });
});
