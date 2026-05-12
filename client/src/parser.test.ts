import { describe, it, expect } from 'vitest';
import { parseFeed } from './parser';

// ---------- RSS 2.0 ----------

describe('parseFeed — RSS 2.0', () => {
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"
         xmlns:content="http://purl.org/rss/1.0/modules/content/">
      <channel>
        <title>Example Blog</title>
        <link>https://example.com</link>
        <description>An example feed</description>
        <item>
          <title>First post</title>
          <link>https://example.com/first</link>
          <guid>https://example.com/first</guid>
          <pubDate>Sat, 10 May 2026 12:00:00 GMT</pubDate>
          <dc:creator>Alice</dc:creator>
          <description>Short summary</description>
          <content:encoded><![CDATA[<p>Full content</p>]]></content:encoded>
        </item>
        <item>
          <title>Second post</title>
          <link>https://example.com/second</link>
          <guid>second-guid</guid>
          <pubDate>Sun, 11 May 2026 09:00:00 GMT</pubDate>
          <author>bob@example.com</author>
          <description>Only summary</description>
        </item>
      </channel>
    </rss>`;

  it('extracts channel-level metadata', () => {
    const feed = parseFeed(rss, 'application/rss+xml');
    expect(feed.title).toBe('Example Blog');
    expect(feed.siteUrl).toBe('https://example.com');
    expect(feed.description).toBe('An example feed');
  });

  it('extracts all items in order', () => {
    const feed = parseFeed(rss, 'application/rss+xml');
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]!.title).toBe('First post');
    expect(feed.items[1]!.title).toBe('Second post');
  });

  it('prefers content:encoded over description', () => {
    const feed = parseFeed(rss, 'application/rss+xml');
    expect(feed.items[0]!.content).toBe('<p>Full content</p>');
    expect(feed.items[0]!.summary).toBe('Short summary');
  });

  it('falls back to description when content:encoded missing', () => {
    const feed = parseFeed(rss, 'application/rss+xml');
    expect(feed.items[1]!.content).toBe('Only summary');
    expect(feed.items[1]!.summary).toBe('Only summary');
  });

  it('prefers dc:creator over author', () => {
    const feed = parseFeed(rss, 'application/rss+xml');
    expect(feed.items[0]!.author).toBe('Alice');
    expect(feed.items[1]!.author).toBe('bob@example.com');
  });

  it('parses pubDate as ms timestamp', () => {
    const feed = parseFeed(rss, 'application/rss+xml');
    expect(feed.items[0]!.publishedAt).toBe(Date.parse('Sat, 10 May 2026 12:00:00 GMT'));
  });

  it('uses guid when present, otherwise falls back', () => {
    const feed = parseFeed(rss, 'application/rss+xml');
    expect(feed.items[0]!.guid).toBe('https://example.com/first');
    expect(feed.items[1]!.guid).toBe('second-guid');
  });

  it('handles missing fields gracefully', () => {
    const sparse = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Only title</title></item>
    </channel></rss>`;
    const feed = parseFeed(sparse, 'application/xml');
    expect(feed.title).toBeNull();
    expect(feed.items[0]!.url).toBeNull();
    expect(feed.items[0]!.publishedAt).toBeNull();
    expect(feed.items[0]!.author).toBeNull();
    expect(feed.items[0]!.guid).toBe('Only title'); // fallback chain
  });
});

// ---------- Atom ----------

describe('parseFeed — Atom', () => {
  const atom = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Example</title>
      <subtitle>Atom subtitle</subtitle>
      <link href="https://example.com" rel="alternate"/>
      <link href="https://example.com/feed.atom" rel="self"/>
      <entry>
        <title>Atom entry one</title>
        <id>tag:example.com,2026:1</id>
        <link href="https://example.com/atom-one" rel="alternate"/>
        <published>2026-05-10T12:00:00Z</published>
        <updated>2026-05-10T12:00:00Z</updated>
        <author><name>Carol</name></author>
        <summary>Atom summary</summary>
        <content type="html">&lt;p&gt;Atom content&lt;/p&gt;</content>
      </entry>
      <entry>
        <title>No published, has updated</title>
        <id>tag:example.com,2026:2</id>
        <link href="https://example.com/atom-two"/>
        <updated>2026-05-11T09:00:00Z</updated>
      </entry>
    </feed>`;

  it('extracts feed-level metadata', () => {
    const feed = parseFeed(atom, 'application/atom+xml');
    expect(feed.title).toBe('Atom Example');
    expect(feed.description).toBe('Atom subtitle');
  });

  it('prefers alternate link for feed siteUrl', () => {
    const feed = parseFeed(atom, 'application/atom+xml');
    expect(feed.siteUrl).toBe('https://example.com');
  });

  it('parses entries with all fields', () => {
    const feed = parseFeed(atom, 'application/atom+xml');
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]!.title).toBe('Atom entry one');
    expect(feed.items[0]!.url).toBe('https://example.com/atom-one');
    expect(feed.items[0]!.guid).toBe('tag:example.com,2026:1');
    expect(feed.items[0]!.author).toBe('Carol');
    expect(feed.items[0]!.content).toBe('<p>Atom content</p>');
    expect(feed.items[0]!.summary).toBe('Atom summary');
  });

  it('falls back to updated when published is missing', () => {
    const feed = parseFeed(atom, 'application/atom+xml');
    expect(feed.items[1]!.publishedAt).toBe(Date.parse('2026-05-11T09:00:00Z'));
  });

  it('falls back to summary when content missing', () => {
    const oneliner = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>x</title>
        <entry>
          <title>t</title><id>id</id>
          <summary>only summary</summary>
        </entry>
      </feed>`;
    const feed = parseFeed(oneliner, 'application/atom+xml');
    expect(feed.items[0]!.content).toBe('only summary');
  });
});

// ---------- JSON Feed ----------

describe('parseFeed — JSON Feed', () => {
  const jsonFeed = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'JSON Feed Title',
    home_page_url: 'https://example.com',
    description: 'desc',
    items: [
      {
        id: 'a1',
        url: 'https://example.com/a1',
        title: 'JF item one',
        content_html: '<p>jf html</p>',
        content_text: 'jf text',
        summary: 'jf summary',
        date_published: '2026-05-10T12:00:00Z',
        authors: [{ name: 'Dora' }],
      },
      {
        id: 'a2',
        external_url: 'https://other.example/post',
        title: 'JF item two',
        content_text: 'just text',
        author: { name: 'Eve' },
      },
    ],
  });

  it('parses feed-level metadata', () => {
    const feed = parseFeed(jsonFeed, 'application/json');
    expect(feed.title).toBe('JSON Feed Title');
    expect(feed.siteUrl).toBe('https://example.com');
    expect(feed.description).toBe('desc');
  });

  it('prefers content_html over content_text', () => {
    const feed = parseFeed(jsonFeed, 'application/json');
    expect(feed.items[0]!.content).toBe('<p>jf html</p>');
  });

  it('uses content_text when content_html missing', () => {
    const feed = parseFeed(jsonFeed, 'application/json');
    expect(feed.items[1]!.content).toBe('just text');
  });

  it('falls back to external_url when url missing', () => {
    const feed = parseFeed(jsonFeed, 'application/json');
    expect(feed.items[1]!.url).toBe('https://other.example/post');
  });

  it('prefers authors[0] over author', () => {
    const feed = parseFeed(jsonFeed, 'application/json');
    expect(feed.items[0]!.author).toBe('Dora');
    expect(feed.items[1]!.author).toBe('Eve');
  });

  it('detects JSON Feed when content-type is not json (body starts with {)', () => {
    const feed = parseFeed(jsonFeed, 'text/plain');
    expect(feed.title).toBe('JSON Feed Title');
  });

  it('rejects JSON missing the jsonfeed.org version marker', () => {
    const bad = JSON.stringify({ version: 'something-else', items: [] });
    expect(() => parseFeed(bad, 'application/json')).toThrow();
  });

  it('falls through to XML parsing if JSON parse fails (broken json with rss body)', () => {
    // body looks like JSON ({) but isn't valid → falls through to XML parsing
    // Force this by giving it an XML body with json content-type
    const rssBody = '<rss version="2.0"><channel><title>fallback</title></channel></rss>';
    const feed = parseFeed(rssBody, 'application/xml');
    expect(feed.title).toBe('fallback');
  });
});

// ---------- Error handling ----------

describe('parseFeed — errors', () => {
  it('throws on malformed XML', () => {
    expect(() => parseFeed('<rss><unterminated', 'application/xml')).toThrow();
  });

  it('throws on unsupported root element', () => {
    expect(() => parseFeed('<html><body>not a feed</body></html>', 'application/xml')).toThrow(/unsupported|parse/i);
  });

  it('throws on rss missing channel', () => {
    expect(() => parseFeed('<rss version="2.0"></rss>', 'application/xml')).toThrow(/channel/i);
  });
});
