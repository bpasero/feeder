import Parser from 'rss-parser';
import { lookup } from 'node:dns/promises';
import { db } from './db.js';

const parser = new Parser();

export type ParsedFeed = {
  title: string | null;
  siteUrl: string | null;
  description: string | null;
  items: ParsedItem[];
};

export type ParsedItem = {
  guid: string;
  title: string | null;
  url: string | null;
  author: string | null;
  content: string | null;
  summary: string | null;
  publishedAt: number | null;
};

function isPrivateIp(ip: string): boolean {
  if (ip.startsWith('127.') || ip === '0.0.0.0') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7));
  return false;
}

async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('invalid url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`unsupported scheme: ${u.protocol}`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const { address } = await lookup(host);
  if (isPrivateIp(address)) {
    throw new Error('refusing to fetch private/loopback host');
  }
  return u;
}

const FETCH_HEADERS = {
  'User-Agent': 'feed-reader/0.1 (+local)',
  Accept:
    'application/json, application/feed+json, application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
};

export async function fetchAsText(url: string): Promise<{ body: string; contentType: string; finalUrl: string }> {
  let current = url;
  const maxRedirects = 5;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      headers: FETCH_HEADERS,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`redirect with no location (${res.status})`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    const contentType = res.headers.get('content-type') ?? '';
    const body = await res.text();
    return { body, contentType, finalUrl: current };
  }
  throw new Error('too many redirects');
}

function looksLikeJsonFeed(body: string, contentType: string): boolean {
  if (contentType.includes('json')) return true;
  const trimmed = body.trimStart();
  return trimmed.startsWith('{');
}

function parseJsonFeed(body: string): ParsedFeed {
  const json = JSON.parse(body) as {
    version?: string;
    title?: string;
    home_page_url?: string;
    description?: string;
    items?: unknown;
  } & Record<string, unknown>;
  if (typeof json.version !== 'string' || !json.version.startsWith('https://jsonfeed.org/version/')) {
    throw new Error('not a JSON Feed (missing or invalid version)');
  }
  if (!Array.isArray(json.items)) {
    throw new Error('not a JSON Feed (items must be an array)');
  }
  type JsonItem = {
    id?: string;
    url?: string;
    external_url?: string;
    title?: string;
    content_html?: string;
    content_text?: string;
    summary?: string;
    date_published?: string;
    author?: { name?: string };
    authors?: Array<{ name?: string }>;
  };
  const items: ParsedItem[] = (json.items as JsonItem[]).map((it) => {
    const url = it.url ?? it.external_url ?? null;
    const guid = it.id ?? url ?? '';
    const authorName = it.authors?.[0]?.name ?? it.author?.name ?? null;
    return {
      guid,
      title: it.title ?? null,
      url,
      author: authorName,
      content: it.content_html ?? it.content_text ?? null,
      summary: it.summary ?? null,
      publishedAt: it.date_published ? Date.parse(it.date_published) || null : null,
    };
  });
  return {
    title: json.title ?? null,
    siteUrl: json.home_page_url ?? null,
    description: json.description ?? null,
    items,
  };
}

function parseRssOrAtom(body: string): Promise<ParsedFeed> {
  return parser.parseString(body).then((feed) => {
    const items: ParsedItem[] = (feed.items ?? []).map((it) => {
      const guid = it.guid ?? it.id ?? it.link ?? it.title ?? '';
      const publishedAt = it.isoDate ? Date.parse(it.isoDate) || null : it.pubDate ? Date.parse(it.pubDate) || null : null;
      return {
        guid,
        title: it.title ?? null,
        url: it.link ?? null,
        author: (it.creator as string | undefined) ?? (it.author as string | undefined) ?? null,
        content: (it['content:encoded'] as string | undefined) ?? it.content ?? null,
        summary: it.contentSnippet ?? it.summary ?? null,
        publishedAt,
      };
    });
    return {
      title: feed.title ?? null,
      siteUrl: feed.link ?? null,
      description: feed.description ?? null,
      items,
    };
  });
}

export async function fetchAndParseFeed(url: string): Promise<ParsedFeed> {
  const { body, contentType } = await fetchAsText(url);
  if (looksLikeJsonFeed(body, contentType)) {
    try {
      return parseJsonFeed(body);
    } catch {
      // Fall through to XML parsing
    }
  }
  return parseRssOrAtom(body);
}

const insertItem = db.prepare(`
  INSERT INTO items (feed_id, guid, title, url, author, content, summary, published_at, read, created_at)
  VALUES (@feed_id, @guid, @title, @url, @author, @content, @summary, @published_at, 0, @created_at)
  ON CONFLICT(feed_id, guid) DO UPDATE SET
    title        = COALESCE(excluded.title,        title),
    url          = COALESCE(excluded.url,          url),
    author       = COALESCE(excluded.author,       author),
    content      = COALESCE(excluded.content,      content),
    summary      = COALESCE(excluded.summary,      summary),
    published_at = COALESCE(excluded.published_at, published_at)
`);

const updateFeedMeta = db.prepare(`
  UPDATE feeds SET title = COALESCE(@title, title), site_url = COALESCE(@site_url, site_url),
                   description = COALESCE(@description, description), last_fetched_at = @last_fetched_at
  WHERE id = @id
`);

export function persistFeedItems(feedId: number, parsed: ParsedFeed): number {
  const now = Date.now();
  updateFeedMeta.run({
    id: feedId,
    title: parsed.title,
    site_url: parsed.siteUrl,
    description: parsed.description,
    last_fetched_at: now,
  });
  const insertMany = db.transaction((items: ParsedItem[]) => {
    for (const it of items) {
      if (!it.guid) continue;
      insertItem.run({
        feed_id: feedId,
        guid: it.guid,
        title: it.title,
        url: it.url,
        author: it.author,
        content: it.content,
        summary: it.summary,
        published_at: it.publishedAt,
        created_at: now,
      });
    }
  });
  insertMany(parsed.items);
  return parsed.items.length;
}
