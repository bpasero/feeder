import { proxyFetch } from './proxy';
import { parseFeed, type ParsedFeed } from './parser';
import { extractReaderArticle } from './reader';
import { store } from './store';
import { seedDefaultFeedsIfEmpty } from './seed';

export type Feed = {
  id: number;
  url: string;
  title: string | null;
  site_url: string | null;
  description: string | null;
  last_fetched_at: number | null;
  created_at: number;
  unread_count: number;
  total_count: number;
};

export type Item = {
  id: number;
  feed_id: number;
  guid: string;
  title: string | null;
  url: string | null;
  author: string | null;
  content: string | null;
  summary: string | null;
  published_at: number | null;
  read: number;
  created_at: number;
  feed_title: string | null;
  feed_url: string;
};

export type ReaderArticle = {
  title: string | null;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  content: string;
  length: number | null;
  fetchedAt: number;
  cached: boolean;
};

async function fetchAndParseFeed(url: string): Promise<ParsedFeed> {
  const { body, contentType } = await proxyFetch(url);
  return parseFeed(body, contentType);
}

async function persistFeedItems(feedId: number, parsed: ParsedFeed): Promise<number> {
  await store.updateFeed(feedId, {
    title: parsed.title,
    site_url: parsed.siteUrl,
    description: parsed.description,
    last_fetched_at: Date.now(),
  });
  return store.upsertItems(
    feedId,
    parsed.items.map((it) => ({
      guid: it.guid,
      title: it.title,
      url: it.url,
      author: it.author,
      content: it.content,
      summary: it.summary,
      published_at: it.publishedAt,
    }))
  );
}

async function decorateFeeds(): Promise<Feed[]> {
  const [feeds, counts] = await Promise.all([store.listFeeds(), store.unreadCounts()]);
  const list = feeds.map<Feed>((f) => ({
    ...f,
    unread_count: counts.get(f.id)?.unread ?? 0,
    total_count: counts.get(f.id)?.total ?? 0,
  }));
  list.sort((a, b) =>
    (a.title ?? a.url).toLowerCase().localeCompare((b.title ?? b.url).toLowerCase())
  );
  return list;
}

async function decorateItems(itemsRaw: Awaited<ReturnType<typeof store.listItems>>): Promise<Item[]> {
  const feedRows = await store.listFeeds();
  const feedById = new Map(feedRows.map((f) => [f.id, f]));
  return itemsRaw.map<Item>((it) => {
    const feed = feedById.get(it.feed_id);
    return {
      ...it,
      feed_title: feed?.title ?? null,
      feed_url: feed?.url ?? '',
    };
  });
}

let initPromise: Promise<void> | null = null;
async function ensureInit(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const feeds = await store.listFeeds();
    if (feeds.length === 0) {
      await seedDefaultFeedsIfEmpty(async (url) => {
        try {
          const parsed = await fetchAndParseFeed(url);
          const id = await store.insertFeed({
            url,
            title: parsed.title,
            site_url: parsed.siteUrl,
            description: parsed.description,
            last_fetched_at: Date.now(),
            created_at: Date.now(),
          });
          await store.upsertItems(
            id,
            parsed.items.map((it) => ({
              guid: it.guid,
              title: it.title,
              url: it.url,
              author: it.author,
              content: it.content,
              summary: it.summary,
              published_at: it.publishedAt,
            }))
          );
        } catch (err) {
          console.warn(`seed: ${url} failed:`, (err as Error).message);
        }
      });
    }
  })();
  return initPromise;
}

export const api = {
  async listFeeds(): Promise<Feed[]> {
    await ensureInit();
    return decorateFeeds();
  },

  async addFeed(url: string): Promise<Feed> {
    await ensureInit();
    const trimmed = url.trim();
    if (!trimmed) throw new Error('url is required');
    const existing = await store.getFeedByUrl(trimmed);
    if (existing) throw new Error('feed already subscribed');
    const parsed = await fetchAndParseFeed(trimmed);
    const id = await store.insertFeed({
      url: trimmed,
      title: parsed.title,
      site_url: parsed.siteUrl,
      description: parsed.description,
      last_fetched_at: Date.now(),
      created_at: Date.now(),
    });
    await store.upsertItems(
      id,
      parsed.items.map((it) => ({
        guid: it.guid,
        title: it.title,
        url: it.url,
        author: it.author,
        content: it.content,
        summary: it.summary,
        published_at: it.publishedAt,
      }))
    );
    const created = await store.getFeed(id);
    if (!created) throw new Error('failed to create feed');
    return { ...created, unread_count: parsed.items.length, total_count: parsed.items.length };
  },

  async deleteFeed(id: number): Promise<void> {
    await store.deleteFeed(id);
  },

  async refreshFeed(id: number): Promise<{ items: number }> {
    const feed = await store.getFeed(id);
    if (!feed) throw new Error('not found');
    const parsed = await fetchAndParseFeed(feed.url);
    const count = await persistFeedItems(id, parsed);
    return { items: count };
  },

  async refreshAll(): Promise<{ ok: number; failed: number }> {
    const feeds = await store.listFeeds();
    const results = await Promise.allSettled(
      feeds.map(async (f) => {
        const parsed = await fetchAndParseFeed(f.url);
        return persistFeedItems(f.id, parsed);
      })
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    return { ok, failed: results.length - ok };
  },

  async listItems(opts: { feedId?: number; unread?: boolean } = {}): Promise<Item[]> {
    await ensureInit();
    const raw = await store.listItems(opts);
    return decorateItems(raw);
  },

  async setItemRead(id: number, read: boolean): Promise<void> {
    await store.setItemRead(id, read);
  },

  async markAllRead(feedId?: number): Promise<void> {
    await store.markAllRead(feedId);
  },

  async getReaderArticle(id: number, opts: { refresh?: boolean } = {}): Promise<ReaderArticle> {
    const item = await store.getItem(id);
    if (!item) throw new Error('not found');
    if (!item.url) throw new Error('item has no source url');

    if (!opts.refresh) {
      const cached = await store.getReader(id);
      if (cached) {
        return {
          title: cached.title,
          byline: cached.byline,
          siteName: cached.site_name,
          excerpt: cached.excerpt,
          content: cached.content,
          length: cached.length,
          fetchedAt: cached.fetched_at,
          cached: true,
        };
      }
    }
    const article = await extractReaderArticle(item.url);
    const fetched_at = Date.now();
    await store.putReader({
      item_id: id,
      title: article.title,
      byline: article.byline,
      site_name: article.siteName,
      excerpt: article.excerpt,
      content: article.content,
      length: article.length,
      fetched_at,
    });
    return {
      title: article.title,
      byline: article.byline,
      siteName: article.siteName,
      excerpt: article.excerpt,
      content: article.content,
      length: article.length,
      fetchedAt: fetched_at,
      cached: false,
    };
  },
};
