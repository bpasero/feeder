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

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listFeeds: () => fetch('/api/feeds').then((r) => json<Feed[]>(r)),
  addFeed: (url: string) =>
    fetch('/api/feeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then((r) => json<Feed>(r)),
  deleteFeed: (id: number) => fetch(`/api/feeds/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),
  refreshFeed: (id: number) => fetch(`/api/feeds/${id}/refresh`, { method: 'POST' }).then((r) => json<{ ok: true; items: number }>(r)),
  refreshAll: () => fetch('/api/feeds/refresh-all', { method: 'POST' }).then((r) => json<{ ok: number; failed: number }>(r)),
  listItems: (opts: { feedId?: number; unread?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (opts.feedId) params.set('feedId', String(opts.feedId));
    if (opts.unread) params.set('unread', '1');
    const qs = params.toString();
    return fetch(`/api/items${qs ? `?${qs}` : ''}`).then((r) => json<Item[]>(r));
  },
  setItemRead: (id: number, read: boolean) =>
    fetch(`/api/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read }),
    }).then((r) => json<{ ok: true }>(r)),
  markAllRead: (feedId?: number) =>
    fetch('/api/items/mark-all-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedId ? { feedId } : {}),
    }).then((r) => json<{ ok: true }>(r)),
  getReaderArticle: (id: number, opts: { refresh?: boolean } = {}) =>
    fetch(`/api/items/${id}/reader${opts.refresh ? '?refresh=1' : ''}`).then((r) =>
      json<ReaderArticle>(r)
    ),
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
