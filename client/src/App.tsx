import { useCallback, useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { api, type Feed, type Item, type ReaderArticle } from './api';
import { ContextMenu, type MenuEntry } from './ContextMenu';

const ICONS = {
  refresh: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2v6h6" />
      <path d="M21 12A9 9 0 0 0 6 5.3L3 8" />
      <path d="M21 22v-6h-6" />
      <path d="M3 12a9 9 0 0 0 15 6.7L21 16" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  copy: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  external: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  ),
  trash: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  eye: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  eyeOff: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  ),
};

type Selection = { kind: 'all' } | { kind: 'feed'; id: number };

function safeHref(u: string | null): string | undefined {
  if (!u) return undefined;
  try {
    const proto = new URL(u).protocol;
    return proto === 'http:' || proto === 'https:' ? u : undefined;
  } catch {
    return undefined;
  }
}

function avatarLabel(f: Feed): string {
  const t = f.title?.trim();
  if (t) return t[0]!.toUpperCase();
  try {
    const host = new URL(f.url).hostname.replace(/^www\./, '');
    return host[0]?.toUpperCase() ?? '?';
  } catch {
    return '?';
  }
}

function avatarHue(f: Feed): number {
  const s = f.title ?? f.url;
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function App() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: 'all' });
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [addUrl, setAddUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readerArticles, setReaderArticles] = useState<Record<number, ReaderArticle>>({});
  const [readerLoadingId, setReaderLoadingId] = useState<number | null>(null);
  const [readerErrors, setReaderErrors] = useState<Record<number, string>>({});
  const [readerPaneVisible, setReaderPaneVisible] = useState<boolean>(() => {
    const stored = localStorage.getItem('readerPaneVisible');
    return stored === null ? true : stored === '1';
  });
  const [menu, setMenu] = useState<{ entries: MenuEntry[]; x: number; y: number } | null>(null);

  useEffect(() => {
    localStorage.setItem('readerPaneVisible', readerPaneVisible ? '1' : '0');
  }, [readerPaneVisible]);

  const loadFeeds = useCallback(async () => {
    try {
      setFeeds(await api.listFeeds());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    loadFeeds();
  }, [loadFeeds]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const feedId = selection.kind === 'feed' ? selection.id : undefined;
        const next = await api.listItems({ feedId, unread: unreadOnly });
        if (!cancelled) setItems(next);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selection, unreadOnly]);

  const reloadItems = useCallback(async () => {
    try {
      const feedId = selection.kind === 'feed' ? selection.id : undefined;
      setItems(await api.listItems({ feedId, unread: unreadOnly }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selection, unreadOnly]);

  const activeItem = useMemo(() => items.find((i) => i.id === activeItemId) ?? null, [items, activeItemId]);
  const activeReader = activeItem ? readerArticles[activeItem.id] : undefined;
  const activeReaderError = activeItem ? readerErrors[activeItem.id] : undefined;
  const isReaderLoading = activeItem !== null && readerLoadingId === activeItem.id && !activeReader;

  const sanitizedContent = useMemo(() => {
    if (!activeItem) return '';
    const raw = activeReader?.content ?? activeItem.content ?? activeItem.summary ?? '<em>No content.</em>';
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] });
  }, [activeItem, activeReader]);

  useEffect(() => {
    if (!activeItem) return;
    if (!readerPaneVisible) return;
    if (!safeHref(activeItem.url)) return;
    const id = activeItem.id;
    if (readerArticles[id] || readerErrors[id]) return;
    let cancelled = false;
    setReaderLoadingId(id);
    api
      .getReaderArticle(id)
      .then((article) => {
        if (cancelled) return;
        setReaderArticles((prev) => ({ ...prev, [id]: article }));
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setReaderErrors((prev) => ({ ...prev, [id]: e.message }));
      })
      .finally(() => {
        if (!cancelled) {
          setReaderLoadingId((cur) => (cur === id ? null : cur));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeItem, readerArticles, readerErrors, readerPaneVisible]);

  async function handleAddFeed(e: React.FormEvent) {
    e.preventDefault();
    if (!addUrl.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.addFeed(addUrl.trim());
      setAddUrl('');
      await loadFeeds();
      await reloadItems();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshAll() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.refreshAll();
      await loadFeeds();
      await reloadItems();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteFeed(id: number) {
    if (!confirm('Unsubscribe from this feed? Its items will be removed.')) return;
    try {
      await api.deleteFeed(id);
      if (selection.kind === 'feed' && selection.id === id) setSelection({ kind: 'all' });
      await loadFeeds();
      await reloadItems();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleOpenItem(item: Item) {
    setActiveItemId(item.id);
    if (!item.read) {
      try {
        await api.setItemRead(item.id, true);
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read: 1 } : i)));
        loadFeeds();
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }

  async function handleToggleRead(item: Item) {
    const next = item.read ? false : true;
    try {
      await api.setItemRead(item.id, next);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read: next ? 1 : 0 } : i)));
      loadFeeds();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleMarkAllRead() {
    const feedId = selection.kind === 'feed' ? selection.id : undefined;
    try {
      await api.markAllRead(feedId);
      await loadFeeds();
      await reloadItems();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const totalUnread = feeds.reduce((acc, f) => acc + f.unread_count, 0);
  const activeHref = activeItem ? safeHref(activeItem.url) : undefined;

  function openMenu(e: React.MouseEvent, entries: MenuEntry[]) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ entries, x: e.clientX, y: e.clientY });
  }

  function allFeedsMenu(): MenuEntry[] {
    return [
      {
        kind: 'item',
        label: 'Refresh all',
        icon: ICONS.refresh,
        onClick: handleRefreshAll,
      },
      {
        kind: 'item',
        label: 'Mark all as read',
        icon: ICONS.check,
        onClick: async () => {
          try {
            await api.markAllRead();
            await loadFeeds();
            await reloadItems();
          } catch (e) {
            setError((e as Error).message);
          }
        },
        disabled: totalUnread === 0,
      },
    ];
  }

  function feedMenu(f: Feed): MenuEntry[] {
    const entries: MenuEntry[] = [
      {
        kind: 'item',
        label: 'Refresh',
        icon: ICONS.refresh,
        onClick: async () => {
          try {
            await api.refreshFeed(f.id);
            await loadFeeds();
            await reloadItems();
          } catch (e) {
            setError((e as Error).message);
          }
        },
      },
      {
        kind: 'item',
        label: 'Mark all as read',
        icon: ICONS.check,
        onClick: async () => {
          try {
            await api.markAllRead(f.id);
            await loadFeeds();
            await reloadItems();
          } catch (e) {
            setError((e as Error).message);
          }
        },
        disabled: f.unread_count === 0,
      },
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'Copy feed URL',
        icon: ICONS.copy,
        onClick: () => navigator.clipboard.writeText(f.url),
      },
    ];
    if (f.site_url && safeHref(f.site_url)) {
      entries.push({
        kind: 'item',
        label: 'Open homepage',
        icon: ICONS.external,
        onClick: () => {
          window.open(f.site_url!, '_blank', 'noopener,noreferrer');
        },
      });
    }
    entries.push(
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'Unsubscribe',
        icon: ICONS.trash,
        destructive: true,
        onClick: () => handleDeleteFeed(f.id),
      }
    );
    return entries;
  }

  function itemMenu(it: Item): MenuEntry[] {
    const href = safeHref(it.url);
    const entries: MenuEntry[] = [
      {
        kind: 'item',
        label: it.read ? 'Mark as unread' : 'Mark as read',
        icon: it.read ? ICONS.eyeOff : ICONS.eye,
        onClick: () => handleToggleRead(it),
      },
      { kind: 'separator' },
    ];
    if (href) {
      entries.push({
        kind: 'item',
        label: 'Open original',
        icon: ICONS.external,
        onClick: () => {
          window.open(href, '_blank', 'noopener,noreferrer');
        },
      });
    }
    if (it.url) {
      entries.push({
        kind: 'item',
        label: 'Copy article URL',
        icon: ICONS.copy,
        onClick: () => navigator.clipboard.writeText(it.url!),
      });
    }
    return entries;
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Feed Reader</h1>
        <form onSubmit={handleAddFeed} className="add-form">
          <input
            type="url"
            placeholder="https://example.com/feed.xml"
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !addUrl.trim()}>Add</button>
        </form>
        <button onClick={handleRefreshAll} disabled={busy}>Refresh all</button>
        <label className="unread-toggle">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Unread only
        </label>
        <button
          className={`pane-toggle ${readerPaneVisible ? 'on' : ''}`}
          onClick={() => setReaderPaneVisible((v) => !v)}
          title={readerPaneVisible ? 'Hide reader pane' : 'Show reader pane'}
          aria-label={readerPaneVisible ? 'Hide reader pane' : 'Show reader pane'}
          aria-pressed={readerPaneVisible}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="15" y1="4" x2="15" y2="20" />
          </svg>
        </button>
      </header>

      {error && <div className="error" onClick={() => setError(null)}>{error}</div>}

      <div className={`body ${readerPaneVisible ? '' : 'no-reader'}`}>
        <aside className="sidebar">
          <div
            className={`feed-item ${selection.kind === 'all' ? 'active' : ''}`}
            onClick={() => setSelection({ kind: 'all' })}
            onContextMenu={(e) => openMenu(e, allFeedsMenu())}
          >
            <span className="feed-avatar feed-avatar-all" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
            </span>
            <span className="feed-title">All feeds</span>
            <span className="badge">{totalUnread}</span>
          </div>
          {feeds.map((f) => (
            <div
              key={f.id}
              className={`feed-item ${selection.kind === 'feed' && selection.id === f.id ? 'active' : ''}`}
              onClick={() => setSelection({ kind: 'feed', id: f.id })}
              onContextMenu={(e) => openMenu(e, feedMenu(f))}
            >
              <span
                className="feed-avatar"
                aria-hidden="true"
                style={{
                  background: `oklch(62% 0.13 ${avatarHue(f)})`,
                  color: 'oklch(99% 0 0)',
                }}
              >
                {avatarLabel(f)}
              </span>
              <span className="feed-title" title={f.url}>{f.title ?? f.url}</span>
              <span className="badge">{f.unread_count}</span>
              <button
                className="feed-delete"
                title="Unsubscribe"
                aria-label="Unsubscribe"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteFeed(f.id);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          ))}
        </aside>

        <main className="items">
          <div className="items-toolbar">
            <span className="items-count">{items.length} items</span>
            <button onClick={handleMarkAllRead}>Mark all read</button>
          </div>
          <ul className="item-list">
            {items.map((it) => (
              <li
                key={it.id}
                className={`item ${it.read ? 'read' : 'unread'} ${activeItemId === it.id ? 'active' : ''}`}
                onClick={() => handleOpenItem(it)}
                onContextMenu={(e) => openMenu(e, itemMenu(it))}
              >
                <div className="item-meta">
                  <span className="item-feed">{it.feed_title ?? 'Unknown'}</span>
                  {it.published_at && <span className="item-date">{new Date(it.published_at).toLocaleString()}</span>}
                </div>
                <div className="item-title">{it.title ?? '(untitled)'}</div>
                {it.summary && <div className="item-summary">{it.summary.slice(0, 200)}</div>}
              </li>
            ))}
            {items.length === 0 && <li className="empty">No items.</li>}
          </ul>
        </main>

        {readerPaneVisible && (
          <section className="reader" aria-label="Article reader">
            <header className="reader-pane-header">
              <div className="reader-pane-context" title={activeItem?.feed_url}>
                {activeItem ? (activeItem.feed_title ?? activeItem.feed_url) : 'Reader'}
              </div>
              <div className="reader-pane-actions">
                {activeItem && (
                  <button onClick={() => handleToggleRead(activeItem)}>
                    Mark as {activeItem.read ? 'unread' : 'read'}
                  </button>
                )}
                {activeItem && activeHref && (
                  <a
                    className="reader-open-original"
                    href={activeHref}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open original
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M7 17L17 7M9 7h8v8" />
                    </svg>
                  </a>
                )}
                <button
                  className="reader-pane-close"
                  onClick={() => setReaderPaneVisible(false)}
                  aria-label="Hide reader pane"
                  title="Hide reader pane"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </header>
            <div className="reader-pane-scroll">
              {activeItem ? (
                <article className="reader-article">
                  <h1 className="reader-article-title">
                    {activeReader?.title ?? activeItem.title ?? '(untitled)'}
                  </h1>
                  <div className="reader-article-byline">
                    {(activeReader?.byline ?? activeItem.author) && (
                      <span>{activeReader?.byline ?? activeItem.author}</span>
                    )}
                    {(activeReader?.byline ?? activeItem.author) && activeItem.published_at && (
                      <span aria-hidden="true">·</span>
                    )}
                    {activeItem.published_at && (
                      <time dateTime={new Date(activeItem.published_at).toISOString()}>
                        {new Date(activeItem.published_at).toLocaleString()}
                      </time>
                    )}
                    {activeReader && (
                      <span className="reader-badge" title="Extracted from source">Reader view</span>
                    )}
                    {activeReaderError && (
                      <span className="reader-badge reader-badge-fallback" title={activeReaderError}>
                        Feed preview
                      </span>
                    )}
                  </div>
                  {isReaderLoading ? (
                    <div className="reader-skeleton" aria-label="Loading article">
                      <div className="reader-skeleton-line" />
                      <div className="reader-skeleton-line" />
                      <div className="reader-skeleton-line" />
                      <div className="reader-skeleton-line" />
                      <div className="reader-skeleton-line" />
                      <div className="reader-skeleton-line" />
                    </div>
                  ) : (
                    <div
                      className="reader-content"
                      dangerouslySetInnerHTML={{ __html: sanitizedContent }}
                    />
                  )}
                </article>
              ) : (
                <div className="reader-empty">Select an article to read.</div>
              )}
            </div>
          </section>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={menu.entries}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
