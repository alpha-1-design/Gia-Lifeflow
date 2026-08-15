import { describe, expect, it } from "vitest";
import { pickMediaFile } from "./freelibrary";

describe("pickMediaFile", () => {
  const files = [
    { name: "cover.jpg", format: "JPEG" },
    { name: "01 Track One.mp3", format: "VBR MP3" },
    { name: "notes.pdf", format: "Text PDF" },
    { name: "movie.mp4", format: "MPEG4" },
  ];

  it("picks the mp3 for music", () => {
    expect(pickMediaFile(files, "music")).toBe("01 Track One.mp3");
  });

  it("picks the mp4 for movies", () => {
    expect(pickMediaFile(files, "movie")).toBe("movie.mp4");
  });

  it("falls back to the format hint when the extension is missing", () => {
    const odd = [{ name: "audio" }, { name: "weird", format: "MP3" }];
    expect(pickMediaFile(odd, "music")).toBe("weird");
  });

  it("returns null when nothing matches", () => {
    expect(pickMediaFile([{ name: "readme.txt" }], "movie")).toBeNull();
  });
});
