import { describe, expect, it } from "bun:test";
import { cueTime, parseSubs } from "./subtitles";

describe("cueTime", () => {
  it("parses h:mm:ss,mmm", () => {
    expect(cueTime("00:01:02,500")).toBe(62.5);
  });
  it("parses mm:ss without hours", () => {
    expect(cueTime("01:05.000")).toBe(65);
  });
  it("handles vtt dots", () => {
    expect(cueTime("00:00:10.750")).toBe(10.75);
  });
});

describe("parseSubs", () => {
  it("parses a standard SRT file", () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,500 --> 00:00:07,000
Second line
with more`;
    const cues = parseSubs(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1, end: 4, text: "Hello world" });
    expect(cues[1]).toEqual({ start: 5.5, end: 7, text: "Second line\nwith more" });
  });

  it("parses a WEBVTT file", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
Caption one

00:00:03.000 --> 00:00:05.000
Caption two`;
    const cues = parseSubs(vtt);
    expect(cues).toHaveLength(2);
    expect(cues[1].start).toBe(3);
  });

  it("ignores blocks without timing lines and malformed cues", () => {
    const junk = `some random text

00:00:01,000 --> 00:00:02,000
valid`;
    expect(parseSubs(junk)).toHaveLength(1);
  });

  it("handles CRLF line endings", () => {
    const srt = "1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n";
    expect(parseSubs(srt)).toHaveLength(1);
  });
});
