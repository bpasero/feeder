import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { db, type FeedRow, type ItemRow } from './db.js';
import { fetchAndParseFeed, persistFeedItems } from './feeds.js';
import { extractReaderArticle, getCachedReader, saveReader } from './reader.js';
import { seedDefaultFeedsIfEmpty } from './seed.js';

const app = new Hono();

function isAllowedOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
  } catch {
    return false;
  }
}

// CSRF guard: any state-changing API call from a browser will include Origin.
// Reject unless it comes from a localhost origin. Non-browser clients (curl,
// scripts) typically omit Origin and are allowed.
app.use('/api/*', async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('origin');
    if (origin && !isAllowedOrigin(origin)) {
      return c.json({ error: 'forbidden origin' }, 403);
    }
  }
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/feeds', (c) => {
  const rows = db.prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM items i WHERE i.feed_id = f.id AND i.read = 0) AS unread_count,
      (SELECT COUNT(*) FROM items i WHERE i.feed_id = f.id) AS total_count
    FROM feeds f
    ORDER BY LOWER(COALESCE(f.title, f.url))
  `).all() as (FeedRow & { unread_count: number; total_count: number })[];
  return c.json(rows);
});

app.post('/api/feeds', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return c.json({ error: 'url is required' }, 400);

  const existing = db.prepare('SELECT id FROM feeds WHERE url = ?').get(url) as { id: number } | undefined;
  if (existing) return c.json({ error: 'feed already subscribed', id: existing.id }, 409);

  let parsed;
  try {
    parsed = await fetchAndParseFeed(url);
  } catch (err) {
    return c.json({ error: `failed to fetch feed: ${(err as Error).message}` }, 502);
  }

  const info = db.prepare(`
    INSERT INTO feeds (url, title, site_url, description, last_fetched_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(url, parsed.title, parsed.siteUrl, parsed.description, Date.now(), Date.now());
  const feedId = Number(info.lastInsertRowid);
  persistFeedItems(feedId, parsed);

  const feed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(feedId) as FeedRow;
  return c.json(feed, 201);
});

app.delete('/api/feeds/:id', (c) => {
  const id = Number(c.req.param('id'));
  const info = db.prepare('DELETE FROM feeds WHERE id = ?').run(id);
  if (info.changes === 0) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

app.post('/api/feeds/:id/refresh', async (c) => {
  const id = Number(c.req.param('id'));
  const feed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(id) as FeedRow | undefined;
  if (!feed) return c.json({ error: 'not found' }, 404);
  try {
    const parsed = await fetchAndParseFeed(feed.url);
    const count = persistFeedItems(id, parsed);
    return c.json({ ok: true, items: count });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

app.post('/api/feeds/refresh-all', async (c) => {
  const feeds = db.prepare('SELECT * FROM feeds').all() as FeedRow[];
  const results = await Promise.allSettled(
    feeds.map(async (f) => {
      const parsed = await fetchAndParseFeed(f.url);
      return persistFeedItems(f.id, parsed);
    })
  );
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - ok;
  return c.json({ ok, failed });
});

app.get('/api/items', (c) => {
  const feedId = c.req.query('feedId');
  const unread = c.req.query('unread');
  const rawLimit = Number(c.req.query('limit') ?? 100);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 500);

  const where: string[] = [];
  const params: Record<string, unknown> = { limit };
  if (feedId) {
    where.push('i.feed_id = @feedId');
    params.feedId = Number(feedId);
  }
  if (unread === '1' || unread === 'true') {
    where.push('i.read = 0');
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT i.*, f.title AS feed_title, f.url AS feed_url
    FROM items i
    JOIN feeds f ON f.id = i.feed_id
    ${whereSql}
    ORDER BY COALESCE(i.published_at, i.created_at) DESC
    LIMIT @limit
  `).all(params) as (ItemRow & { feed_title: string | null; feed_url: string })[];

  return c.json(rows);
});

app.get('/api/items/:id/reader', async (c) => {
  const id = Number(c.req.param('id'));
  const item = db.prepare('SELECT id, url FROM items WHERE id = ?').get(id) as { id: number; url: string | null } | undefined;
  if (!item) return c.json({ error: 'not found' }, 404);
  if (!item.url) return c.json({ error: 'item has no source url' }, 400);

  const force = c.req.query('refresh') === '1';
  if (!force) {
    const cached = getCachedReader(id);
    if (cached) {
      return c.json({
        title: cached.title,
        byline: cached.byline,
        siteName: cached.site_name,
        excerpt: cached.excerpt,
        content: cached.content,
        length: cached.length,
        fetchedAt: cached.fetched_at,
        cached: true,
      });
    }
  }

  try {
    const article = await extractReaderArticle(item.url);
    const saved = saveReader(id, article);
    return c.json({
      title: saved.title,
      byline: saved.byline,
      siteName: saved.site_name,
      excerpt: saved.excerpt,
      content: saved.content,
      length: saved.length,
      fetchedAt: saved.fetched_at,
      cached: false,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

app.patch('/api/items/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.read !== 'boolean') return c.json({ error: 'read (boolean) required' }, 400);
  const info = db.prepare('UPDATE items SET read = ? WHERE id = ?').run(body.read ? 1 : 0, id);
  if (info.changes === 0) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

app.post('/api/items/mark-all-read', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  let feedId: number | null = null;
  if (body.feedId !== undefined && body.feedId !== null) {
    const n = Number(body.feedId);
    if (!Number.isInteger(n) || n <= 0) {
      return c.json({ error: 'feedId must be a positive integer' }, 400);
    }
    feedId = n;
  }
  if (feedId !== null) {
    db.prepare('UPDATE items SET read = 1 WHERE feed_id = ?').run(feedId);
  } else {
    db.prepare('UPDATE items SET read = 1').run();
  }
  return c.json({ ok: true });
});

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`feed-reader server listening on http://localhost:${info.port}`);
  seedDefaultFeedsIfEmpty().catch((e) => console.error('seed: error', e));
});
