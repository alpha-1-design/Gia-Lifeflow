import { describe, expect, it } from "vitest";
import { parseFeedXml } from "./clients";

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>First &amp; Best</title>
      <link>https://example.com/1</link>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
      <description><![CDATA[<p>Hello <b>world</b></p>]]></description>
    </item>
    <item>
      <title>Second</title>
      <link>https://example.com/2</link>
      <content:encoded xmlns:content="http://purl.org/rss/1.0/modules/content/"><![CDATA[<p>Rich content &amp; more</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom Entry</title>
    <link href="https://example.com/atom/1"/>
    <published>2024-01-01T12:00:00Z</published>
    <summary>Summary text here</summary>
  </entry>
</feed>`;

describe("parseFeedXml", () => {
  it("parses RSS 2.0 items with title, link, date and stripped snippet", () => {
    const items = parseFeedXml(RSS, "example.com");
    expect(items).toHaveLength(2);

    expect(items[0].title).toBe("First & Best");
    expect(items[0].link).toBe("https://example.com/1");
    expect(items[0].snippet).toBe("Hello world");
    expect(items[0].date).toBe(Date.parse("Mon, 01 Jan 2024 12:00:00 GMT"));

    expect(items[1].title).toBe("Second");
    expect(items[1].snippet).toBe("Rich content & more");
  });

  it("parses Atom entries using the link href attribute", () => {
    const items = parseFeedXml(ATOM, "example.com");
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Atom Entry");
    expect(items[0].link).toBe("https://example.com/atom/1");
    expect(items[0].snippet).toBe("Summary text here");
    expect(items[0].date).toBe(Date.parse("2024-01-01T12:00:00Z"));
  });

  it("returns an empty list for malformed or empty XML", () => {
    expect(parseFeedXml("<not closed", "example.com")).toEqual([]);
    expect(parseFeedXml("", "example.com")).toEqual([]);
  });
});
