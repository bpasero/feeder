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

function text(el: Element | null | undefined): string | null {
  if (!el) return null;
  const t = el.textContent?.trim();
  return t ? t : null;
}

// Many feeds wrap titles/descriptions in CDATA with HTML entities inside
// (e.g. `<title><![CDATA[Palantir&#8217;s ...]]></title>`). CDATA suppresses
// XML entity decoding, so `&#8217;` survives as literal text. Decode it as
// HTML so the right single-quote (and friends) render correctly.
function decodeHtmlEntities(s: string | null): string | null {
  if (s === null) return null;
  if (!s.includes('&')) return s;
  // <textarea> has a raw-text content model: setting innerHTML decodes
  // character references but does NOT parse tags, so a literal `<` in a
  // title (e.g. "5 < 10") is preserved verbatim.
  const ta = document.createElement('textarea');
  ta.innerHTML = s;
  return ta.value;
}

function plain(el: Element | null | undefined): string | null {
  return decodeHtmlEntities(text(el));
}

function firstChild(parent: Element, ...names: string[]): Element | null {
  for (const name of names) {
    for (const child of Array.from(parent.children)) {
      if (child.localName === name) return child;
    }
  }
  return null;
}

function allChildren(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter((c) => c.localName === name);
}

function parseDate(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function parseRss(channel: Element): ParsedFeed {
  const items: ParsedItem[] = allChildren(channel, 'item').map((it): ParsedItem => {
    const guid = text(firstChild(it, 'guid')) ?? text(firstChild(it, 'link')) ?? text(firstChild(it, 'title')) ?? '';
    const link = text(firstChild(it, 'link'));
    const contentEncoded = text(firstChild(it, 'encoded')); // content:encoded
    const description = text(firstChild(it, 'description'));
    const author = plain(firstChild(it, 'creator')) ?? plain(firstChild(it, 'author'));
    const pub = text(firstChild(it, 'pubDate')) ?? text(firstChild(it, 'date'));
    return {
      guid,
      title: plain(firstChild(it, 'title')),
      url: link,
      author,
      content: contentEncoded ?? description,
      summary: description,
      publishedAt: parseDate(pub),
    };
  });
  return {
    title: plain(firstChild(channel, 'title')),
    siteUrl: text(firstChild(channel, 'link')),
    description: plain(firstChild(channel, 'description')),
    items,
  };
}

function atomLink(entry: Element): string | null {
  const links = allChildren(entry, 'link');
  // Prefer rel="alternate" or no rel attr
  for (const l of links) {
    const rel = l.getAttribute('rel');
    if (!rel || rel === 'alternate') {
      const href = l.getAttribute('href');
      if (href) return href;
    }
  }
  const fallback = links[0]?.getAttribute('href');
  return fallback ?? null;
}

function parseAtom(feed: Element): ParsedFeed {
  const items: ParsedItem[] = allChildren(feed, 'entry').map((entry): ParsedItem => {
    const link = atomLink(entry);
    const id = text(firstChild(entry, 'id'));
    const guid = id ?? link ?? text(firstChild(entry, 'title')) ?? '';
    const summary = text(firstChild(entry, 'summary'));
    const content = text(firstChild(entry, 'content'));
    const author = plain(firstChild(firstChild(entry, 'author') ?? entry, 'name'));
    const pub = text(firstChild(entry, 'published')) ?? text(firstChild(entry, 'updated'));
    return {
      guid,
      title: plain(firstChild(entry, 'title')),
      url: link,
      author,
      content: content ?? summary,
      summary,
      publishedAt: parseDate(pub),
    };
  });
  return {
    title: plain(firstChild(feed, 'title')),
    siteUrl: atomLink(feed),
    description: plain(firstChild(feed, 'subtitle')),
    items,
  };
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

function parseJsonFeed(body: string): ParsedFeed {
  const json = JSON.parse(body) as {
    version?: string;
    title?: string;
    home_page_url?: string;
    description?: string;
    items?: JsonItem[];
  };
  if (typeof json.version !== 'string' || !json.version.startsWith('https://jsonfeed.org/version/')) {
    throw new Error('not a JSON Feed (missing or invalid version)');
  }
  if (!Array.isArray(json.items)) {
    throw new Error('not a JSON Feed (items must be an array)');
  }
  const items: ParsedItem[] = json.items.map((it) => {
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

export function parseFeed(body: string, contentType: string): ParsedFeed {
  const ct = contentType.toLowerCase();
  const trimmed = body.trimStart();
  if (ct.includes('json') || trimmed.startsWith('{')) {
    try {
      return parseJsonFeed(body);
    } catch {
      // fall through
    }
  }
  const doc = new DOMParser().parseFromString(body, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('feed parse error');
  const root = doc.documentElement;
  if (root.localName === 'rss') {
    const channel = firstChild(root, 'channel');
    if (!channel) throw new Error('rss missing channel');
    return parseRss(channel);
  }
  if (root.localName === 'feed') {
    return parseAtom(root);
  }
  if (root.localName === 'channel') {
    return parseRss(root);
  }
  throw new Error(`unsupported feed root: <${root.localName}>`);
}
