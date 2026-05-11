import { db } from './db.js';
import { fetchAndParseFeed, persistFeedItems } from './feeds.js';

export const DEFAULT_FEEDS = [
  'https://hnrss.org/frontpage',
  'https://lobste.rs/rss',
  'https://www.theverge.com/rss/index.xml',
  'https://feeds.arstechnica.com/arstechnica/index',
  'https://daringfireball.net/feeds/main',
  'https://feeds.bbci.co.uk/news/technology/rss.xml',
];

export async function seedDefaultFeedsIfEmpty(): Promise<void> {
  const row = db.prepare('SELECT COUNT(*) AS n FROM feeds').get() as { n: number };
  if (row.n > 0) return;

  console.log(`seed: subscribing to ${DEFAULT_FEEDS.length} default feeds…`);
  const insert = db.prepare(`INSERT INTO feeds (url, created_at) VALUES (?, ?)`);

  await Promise.allSettled(
    DEFAULT_FEEDS.map(async (url) => {
      try {
        const info = insert.run(url, Date.now());
        const id = Number(info.lastInsertRowid);
        const parsed = await fetchAndParseFeed(url);
        persistFeedItems(id, parsed);
        console.log(`seed: ✓ ${url} (${parsed.items.length} items)`);
      } catch (err) {
        console.error(`seed: ✗ ${url} — ${(err as Error).message}`);
      }
    })
  );
  console.log('seed: done');
}
