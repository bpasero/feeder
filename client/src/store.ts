// Minimal IndexedDB wrapper for feeds / items / reader_articles.
// No external deps — each operation is promisified inline.

const DB_NAME = 'feed-reader';
const DB_VERSION = 1;

export type StoredFeed = {
  id: number;
  url: string;
  title: string | null;
  site_url: string | null;
  description: string | null;
  last_fetched_at: number | null;
  created_at: number;
};

export type StoredItem = {
  id: number;
  feed_id: number;
  guid: string;
  title: string | null;
  url: string | null;
  author: string | null;
  content: string | null;
  summary: string | null;
  published_at: number | null;
  read: 0 | 1;
  created_at: number;
};

export type StoredReader = {
  item_id: number;
  title: string | null;
  byline: string | null;
  site_name: string | null;
  excerpt: string | null;
  content: string;
  length: number | null;
  fetched_at: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

// Drops the cached connection so the next call to `openDb` re-opens. Used by
// tests after wiping `indexedDB`; never invoked in app code.
export function _resetForTests(): void {
  dbPromise = null;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('feeds')) {
        const feeds = db.createObjectStore('feeds', { keyPath: 'id', autoIncrement: true });
        feeds.createIndex('url', 'url', { unique: true });
      }
      if (!db.objectStoreNames.contains('items')) {
        const items = db.createObjectStore('items', { keyPath: 'id', autoIncrement: true });
        items.createIndex('feed_id', 'feed_id');
        items.createIndex('feed_guid', ['feed_id', 'guid'], { unique: true });
        items.createIndex('published_at', 'published_at');
      }
      if (!db.objectStoreNames.contains('reader_articles')) {
        db.createObjectStore('reader_articles', { keyPath: 'item_id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  run: (stores: IDBObjectStore[]) => Promise<T> | T
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const transaction = db.transaction(names, mode);
        const stores = names.map((n) => transaction.objectStore(n));
        let result: T;
        let resolved = false;
        let runError: unknown = null;
        // Capture request-level errors here; the IDB event handlers below
        // decide which outcome reaches the outer promise. We don't reject
        // the outer promise from here directly because that would race the
        // transaction's own error/abort events.
        Promise.resolve(run(stores))
          .then((value) => {
            result = value;
            resolved = true;
          })
          .catch((err) => {
            runError = err;
          });
        transaction.oncomplete = () => {
          if (resolved) resolve(result);
          else reject(runError ?? new Error('transaction completed without result'));
        };
        // `onerror` fires before `onabort` and can race the request-level
        // rejection — at that point `transaction.error` is sometimes still
        // null. `onabort` runs after request microtasks settle, so by the
        // time it fires `runError` and `transaction.error` are populated.
        transaction.onabort = () =>
          reject(runError ?? transaction.error ?? new Error('transaction aborted'));
      })
  );
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const store = {
  // -------- feeds --------
  async listFeeds(): Promise<StoredFeed[]> {
    return tx('feeds', 'readonly', ([s]) => req(s.getAll() as IDBRequest<StoredFeed[]>));
  },
  async getFeed(id: number): Promise<StoredFeed | undefined> {
    return tx('feeds', 'readonly', ([s]) => req(s.get(id) as IDBRequest<StoredFeed | undefined>));
  },
  async getFeedByUrl(url: string): Promise<StoredFeed | undefined> {
    return tx('feeds', 'readonly', ([s]) =>
      req(s.index('url').get(url) as IDBRequest<StoredFeed | undefined>)
    );
  },
  async insertFeed(feed: Omit<StoredFeed, 'id'>): Promise<number> {
    return tx('feeds', 'readwrite', ([s]) =>
      req(s.add(feed as unknown as StoredFeed) as IDBRequest<IDBValidKey>).then((key) =>
        Number(key)
      )
    );
  },
  async updateFeed(id: number, patch: Partial<StoredFeed>): Promise<void> {
    await tx('feeds', 'readwrite', async ([s]) => {
      const existing = await req(s.get(id) as IDBRequest<StoredFeed | undefined>);
      if (!existing) throw new Error('feed not found');
      const merged: StoredFeed = { ...existing, ...patch, id };
      await req(s.put(merged) as IDBRequest<IDBValidKey>);
    });
  },
  async deleteFeed(id: number): Promise<void> {
    await tx(['feeds', 'items', 'reader_articles'], 'readwrite', async ([feeds, items, readers]) => {
      const itemIdx = items.index('feed_id');
      const itemKeys = await req(itemIdx.getAllKeys(IDBKeyRange.only(id)) as IDBRequest<number[]>);
      for (const key of itemKeys) {
        await req(items.delete(key));
        await req(readers.delete(key));
      }
      await req(feeds.delete(id));
    });
  },

  // -------- items --------
  async listItems(opts: { feedId?: number; unread?: boolean } = {}): Promise<StoredItem[]> {
    return tx('items', 'readonly', async ([s]) => {
      let raw: StoredItem[];
      if (opts.feedId !== undefined) {
        raw = await req(s.index('feed_id').getAll(IDBKeyRange.only(opts.feedId)) as IDBRequest<StoredItem[]>);
      } else {
        raw = await req(s.getAll() as IDBRequest<StoredItem[]>);
      }
      if (opts.unread) raw = raw.filter((i) => i.read === 0);
      raw.sort((a, b) => (b.published_at ?? b.created_at) - (a.published_at ?? a.created_at));
      return raw;
    });
  },
  async getItem(id: number): Promise<StoredItem | undefined> {
    return tx('items', 'readonly', ([s]) => req(s.get(id) as IDBRequest<StoredItem | undefined>));
  },
  async upsertItems(feedId: number, items: Omit<StoredItem, 'id' | 'feed_id' | 'read' | 'created_at'>[]): Promise<number> {
    return tx('items', 'readwrite', async ([s]) => {
      const idx = s.index('feed_guid');
      const now = Date.now();
      let count = 0;
      for (const it of items) {
        if (!it.guid) continue;
        const existing = await req(
          idx.get([feedId, it.guid]) as IDBRequest<StoredItem | undefined>
        );
        if (existing) {
          const merged: StoredItem = {
            ...existing,
            title: it.title ?? existing.title,
            url: it.url ?? existing.url,
            author: it.author ?? existing.author,
            content: it.content ?? existing.content,
            summary: it.summary ?? existing.summary,
            published_at: it.published_at ?? existing.published_at,
          };
          await req(s.put(merged) as IDBRequest<IDBValidKey>);
        } else {
          const fresh = {
            feed_id: feedId,
            guid: it.guid,
            title: it.title,
            url: it.url,
            author: it.author,
            content: it.content,
            summary: it.summary,
            published_at: it.published_at,
            read: 0 as 0 | 1,
            created_at: now,
          };
          await req(s.add(fresh) as IDBRequest<IDBValidKey>);
        }
        count++;
      }
      return count;
    });
  },
  async setItemRead(id: number, read: boolean): Promise<void> {
    await tx('items', 'readwrite', async ([s]) => {
      const existing = await req(s.get(id) as IDBRequest<StoredItem | undefined>);
      if (!existing) throw new Error('item not found');
      const next: StoredItem = { ...existing, read: read ? 1 : 0 };
      await req(s.put(next) as IDBRequest<IDBValidKey>);
    });
  },
  async markAllRead(feedId?: number): Promise<void> {
    await tx('items', 'readwrite', async ([s]) => {
      let cursorReq: IDBRequest<IDBCursorWithValue | null>;
      if (feedId !== undefined) {
        cursorReq = s.index('feed_id').openCursor(IDBKeyRange.only(feedId));
      } else {
        cursorReq = s.openCursor();
      }
      await new Promise<void>((resolve, reject) => {
        cursorReq.onsuccess = () => {
          const c = cursorReq.result;
          if (!c) {
            resolve();
            return;
          }
          if ((c.value as StoredItem).read !== 1) {
            c.update({ ...(c.value as StoredItem), read: 1 });
          }
          c.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });
    });
  },
  async unreadCounts(): Promise<Map<number, { unread: number; total: number }>> {
    return tx('items', 'readonly', async ([s]) => {
      const all = await req(s.getAll() as IDBRequest<StoredItem[]>);
      const map = new Map<number, { unread: number; total: number }>();
      for (const it of all) {
        const cur = map.get(it.feed_id) ?? { unread: 0, total: 0 };
        cur.total++;
        if (it.read === 0) cur.unread++;
        map.set(it.feed_id, cur);
      }
      return map;
    });
  },

  // -------- reader articles --------
  async getReader(itemId: number): Promise<StoredReader | undefined> {
    return tx('reader_articles', 'readonly', ([s]) =>
      req(s.get(itemId) as IDBRequest<StoredReader | undefined>)
    );
  },
  async putReader(article: StoredReader): Promise<void> {
    await tx('reader_articles', 'readwrite', ([s]) => req(s.put(article) as IDBRequest<IDBValidKey>));
  },
};
