import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { store, _resetForTests } from './store';

beforeEach(() => {
  // Wipe and re-attach a fresh IndexedDB before every test.
  globalThis.indexedDB = new IDBFactory();
  _resetForTests();
});

async function makeFeed(overrides: Partial<{ url: string; title: string | null }> = {}) {
  return store.insertFeed({
    url: overrides.url ?? 'https://example.com/feed.xml',
    title: overrides.title ?? 'Example',
    site_url: 'https://example.com',
    description: null,
    last_fetched_at: null,
    created_at: Date.now(),
  });
}

// ---------- feeds ----------

describe('store — feeds', () => {
  it('insertFeed + listFeeds round-trip', async () => {
    const id = await makeFeed();
    expect(typeof id).toBe('number');
    const feeds = await store.listFeeds();
    expect(feeds).toHaveLength(1);
    expect(feeds[0]!.title).toBe('Example');
    expect(feeds[0]!.id).toBe(id);
  });

  it('getFeed returns the stored row', async () => {
    const id = await makeFeed({ url: 'https://a.example/' });
    const feed = await store.getFeed(id);
    expect(feed?.url).toBe('https://a.example/');
  });

  it('getFeed returns undefined for missing id', async () => {
    await expect(store.getFeed(999)).resolves.toBeUndefined();
  });

  it('getFeedByUrl finds existing feed', async () => {
    await makeFeed({ url: 'https://x.example/' });
    const f = await store.getFeedByUrl('https://x.example/');
    expect(f?.url).toBe('https://x.example/');
  });

  it('enforces unique url constraint', async () => {
    await makeFeed({ url: 'https://dup.example/' });
    await expect(makeFeed({ url: 'https://dup.example/' })).rejects.toBeTruthy();
  });

  it('updateFeed merges fields', async () => {
    const id = await makeFeed();
    await store.updateFeed(id, { title: 'Renamed', last_fetched_at: 12345 });
    const feed = await store.getFeed(id);
    expect(feed?.title).toBe('Renamed');
    expect(feed?.last_fetched_at).toBe(12345);
    expect(feed?.url).toBe('https://example.com/feed.xml');
  });

  it('updateFeed rejects for missing id', async () => {
    await expect(store.updateFeed(999, { title: 'x' })).rejects.toThrow(/not found/i);
  });

  it('deleteFeed cascades items and reader_articles', async () => {
    const id = await makeFeed();
    await store.upsertItems(id, [
      { guid: 'g1', title: 't1', url: 'u1', author: null, content: null, summary: null, published_at: 1 },
    ]);
    const items = await store.listItems({ feedId: id });
    expect(items).toHaveLength(1);
    await store.putReader({
      item_id: items[0]!.id,
      title: null, byline: null, site_name: null, excerpt: null,
      content: '<p>x</p>', length: 1, fetched_at: Date.now(),
    });
    await expect(store.getReader(items[0]!.id)).resolves.toBeDefined();

    await store.deleteFeed(id);

    await expect(store.getFeed(id)).resolves.toBeUndefined();
    await expect(store.listItems({ feedId: id })).resolves.toEqual([]);
    await expect(store.getReader(items[0]!.id)).resolves.toBeUndefined();
  });
});

// ---------- items ----------

describe('store — items', () => {
  it('upsertItems inserts new items', async () => {
    const fid = await makeFeed();
    const count = await store.upsertItems(fid, [
      { guid: 'a', title: 'A', url: null, author: null, content: null, summary: null, published_at: 100 },
      { guid: 'b', title: 'B', url: null, author: null, content: null, summary: null, published_at: 200 },
    ]);
    expect(count).toBe(2);
    const items = await store.listItems({ feedId: fid });
    expect(items.map((i) => i.guid)).toEqual(['b', 'a']); // sorted desc by published_at
  });

  it('upsertItems updates existing items by (feed_id, guid) without duplicating', async () => {
    const fid = await makeFeed();
    await store.upsertItems(fid, [
      { guid: 'a', title: 'old', url: null, author: null, content: null, summary: 'old summary', published_at: 100 },
    ]);
    await store.upsertItems(fid, [
      { guid: 'a', title: 'new', url: 'new-url', author: 'me', content: null, summary: null, published_at: 999 },
    ]);
    const items = await store.listItems({ feedId: fid });
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('new');
    expect(items[0]!.url).toBe('new-url');
    expect(items[0]!.author).toBe('me');
    expect(items[0]!.summary).toBe('old summary'); // preserved on null
    expect(items[0]!.published_at).toBe(999);
    expect(items[0]!.read).toBe(0); // preserved
  });

  it('skips items with empty guid', async () => {
    const fid = await makeFeed();
    const count = await store.upsertItems(fid, [
      { guid: '', title: 'no guid', url: null, author: null, content: null, summary: null, published_at: 100 },
    ]);
    expect(count).toBe(0);
    await expect(store.listItems({ feedId: fid })).resolves.toEqual([]);
  });

  it('listItems sorts by published_at descending, falls back to created_at', async () => {
    const fid = await makeFeed();
    await store.upsertItems(fid, [
      { guid: 'old', title: 'old', url: null, author: null, content: null, summary: null, published_at: 100 },
      { guid: 'new', title: 'new', url: null, author: null, content: null, summary: null, published_at: 500 },
      { guid: 'no-date', title: 'no-date', url: null, author: null, content: null, summary: null, published_at: null },
    ]);
    const items = await store.listItems({ feedId: fid });
    // most recent first; the null-date item sorts by created_at which is now
    expect(items[0]!.guid === 'no-date' || items[0]!.guid === 'new').toBe(true);
  });

  it('listItems can filter by feedId', async () => {
    const f1 = await makeFeed({ url: 'https://a.example/' });
    const f2 = await makeFeed({ url: 'https://b.example/' });
    await store.upsertItems(f1, [
      { guid: '1', title: '1', url: null, author: null, content: null, summary: null, published_at: 1 },
    ]);
    await store.upsertItems(f2, [
      { guid: '2', title: '2', url: null, author: null, content: null, summary: null, published_at: 2 },
    ]);
    const f1Items = await store.listItems({ feedId: f1 });
    expect(f1Items).toHaveLength(1);
    expect(f1Items[0]!.guid).toBe('1');
    const all = await store.listItems();
    expect(all).toHaveLength(2);
  });

  it('listItems unread:true filters out read items', async () => {
    const fid = await makeFeed();
    await store.upsertItems(fid, [
      { guid: 'a', title: 'a', url: null, author: null, content: null, summary: null, published_at: 1 },
      { guid: 'b', title: 'b', url: null, author: null, content: null, summary: null, published_at: 2 },
    ]);
    const items = await store.listItems({ feedId: fid });
    await store.setItemRead(items[0]!.id, true);
    const unread = await store.listItems({ feedId: fid, unread: true });
    expect(unread).toHaveLength(1);
  });

  it('setItemRead toggles read state', async () => {
    const fid = await makeFeed();
    await store.upsertItems(fid, [
      { guid: 'a', title: 'a', url: null, author: null, content: null, summary: null, published_at: 1 },
    ]);
    const [item] = await store.listItems({ feedId: fid });
    expect(item!.read).toBe(0);
    await store.setItemRead(item!.id, true);
    await expect(store.getItem(item!.id)).resolves.toMatchObject({ read: 1 });
    await store.setItemRead(item!.id, false);
    await expect(store.getItem(item!.id)).resolves.toMatchObject({ read: 0 });
  });

  it('setItemRead rejects for missing id', async () => {
    await expect(store.setItemRead(999, true)).rejects.toThrow(/not found/i);
  });

  it('markAllRead with no feedId marks every item read', async () => {
    const f1 = await makeFeed({ url: 'https://a.example/' });
    const f2 = await makeFeed({ url: 'https://b.example/' });
    await store.upsertItems(f1, [
      { guid: '1', title: '1', url: null, author: null, content: null, summary: null, published_at: 1 },
    ]);
    await store.upsertItems(f2, [
      { guid: '2', title: '2', url: null, author: null, content: null, summary: null, published_at: 2 },
    ]);
    await store.markAllRead();
    const all = await store.listItems();
    expect(all.every((i) => i.read === 1)).toBe(true);
  });

  it('markAllRead with feedId scopes to that feed', async () => {
    const f1 = await makeFeed({ url: 'https://a.example/' });
    const f2 = await makeFeed({ url: 'https://b.example/' });
    await store.upsertItems(f1, [
      { guid: '1', title: '1', url: null, author: null, content: null, summary: null, published_at: 1 },
    ]);
    await store.upsertItems(f2, [
      { guid: '2', title: '2', url: null, author: null, content: null, summary: null, published_at: 2 },
    ]);
    await store.markAllRead(f1);
    const f1Items = await store.listItems({ feedId: f1 });
    const f2Items = await store.listItems({ feedId: f2 });
    expect(f1Items[0]!.read).toBe(1);
    expect(f2Items[0]!.read).toBe(0);
  });
});

// ---------- counts ----------

describe('store — unreadCounts', () => {
  it('returns zero map when there are no items', async () => {
    const counts = await store.unreadCounts();
    expect(counts.size).toBe(0);
  });

  it('aggregates per feed and tracks unread vs total', async () => {
    const f1 = await makeFeed({ url: 'https://a.example/' });
    const f2 = await makeFeed({ url: 'https://b.example/' });
    await store.upsertItems(f1, [
      { guid: 'a', title: 'a', url: null, author: null, content: null, summary: null, published_at: 1 },
      { guid: 'b', title: 'b', url: null, author: null, content: null, summary: null, published_at: 2 },
      { guid: 'c', title: 'c', url: null, author: null, content: null, summary: null, published_at: 3 },
    ]);
    await store.upsertItems(f2, [
      { guid: 'd', title: 'd', url: null, author: null, content: null, summary: null, published_at: 4 },
    ]);
    const items = await store.listItems({ feedId: f1 });
    await store.setItemRead(items[0]!.id, true);
    const counts = await store.unreadCounts();
    expect(counts.get(f1)).toEqual({ unread: 2, total: 3 });
    expect(counts.get(f2)).toEqual({ unread: 1, total: 1 });
  });
});

// ---------- reader_articles ----------

describe('store — reader articles', () => {
  it('roundtrips a reader article', async () => {
    const fid = await makeFeed();
    await store.upsertItems(fid, [
      { guid: 'a', title: 'a', url: 'https://example.com/a', author: null, content: null, summary: null, published_at: 1 },
    ]);
    const [item] = await store.listItems({ feedId: fid });
    await store.putReader({
      item_id: item!.id,
      title: 'extracted',
      byline: 'somebody',
      site_name: 'example',
      excerpt: 'snippet',
      content: '<p>full body</p>',
      length: 1234,
      fetched_at: 9999,
    });
    const got = await store.getReader(item!.id);
    expect(got?.title).toBe('extracted');
    expect(got?.content).toBe('<p>full body</p>');
    expect(got?.length).toBe(1234);
  });

  it('putReader overwrites on duplicate item_id', async () => {
    const fid = await makeFeed();
    await store.upsertItems(fid, [
      { guid: 'a', title: 'a', url: 'u', author: null, content: null, summary: null, published_at: 1 },
    ]);
    const [item] = await store.listItems({ feedId: fid });
    const base = {
      item_id: item!.id,
      title: null, byline: null, site_name: null, excerpt: null, length: null,
    };
    await store.putReader({ ...base, content: 'first', fetched_at: 1 });
    await store.putReader({ ...base, content: 'second', fetched_at: 2 });
    const got = await store.getReader(item!.id);
    expect(got?.content).toBe('second');
    expect(got?.fetched_at).toBe(2);
  });

  it('getReader returns undefined when missing', async () => {
    await expect(store.getReader(999)).resolves.toBeUndefined();
  });
});
