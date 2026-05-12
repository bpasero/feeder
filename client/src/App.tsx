import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Feed, type Item, type ReaderArticle } from './api';
import { ContextMenu, type MenuEntry } from './ContextMenu';
import { sanitizeHtml, isSafeHttpUrl, htmlToPlainText } from './sanitize';

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
  if (!u || !isSafeHttpUrl(u)) return undefined;
  return u;
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
  const [openTabs, setOpenTabs] = useState<Item[]>([]);
  const [addUrl, setAddUrl] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const addInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readerArticles, setReaderArticles] = useState<Record<number, ReaderArticle>>({});
  const [readerLoadingId, setReaderLoadingId] = useState<number | null>(null);
  const [readerErrors, setReaderErrors] = useState<Record<number, string>>({});
  const [readerPaneVisible, setReaderPaneVisible] = useState<boolean>(() => {
    const stored = localStorage.getItem('readerPaneVisible');
    return stored === null ? true : stored === '1';
  });
  const [showOriginal, setShowOriginal] = useState<boolean>(() => localStorage.getItem('showOriginal') === '1');
  const [gridMode, setGridMode] = useState<boolean>(() => localStorage.getItem('gridMode') === '1');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => localStorage.getItem('sidebarCollapsed') === '1');
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ entries: MenuEntry[]; x: number; y: number } | null>(null);

  useEffect(() => {
    localStorage.setItem('readerPaneVisible', readerPaneVisible ? '1' : '0');
  }, [readerPaneVisible]);

  useEffect(() => {
    localStorage.setItem('showOriginal', showOriginal ? '1' : '0');
  }, [showOriginal]);

  useEffect(() => {
    localStorage.setItem('gridMode', gridMode ? '1' : '0');
  }, [gridMode]);

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

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

  const activeItem = useMemo(
    () => openTabs.find((t) => t.id === activeItemId) ?? items.find((i) => i.id === activeItemId) ?? null,
    [openTabs, items, activeItemId]
  );
  const activeReader = activeItem ? readerArticles[activeItem.id] : undefined;
  const activeReaderError = activeItem ? readerErrors[activeItem.id] : undefined;
  const isReaderLoading = activeItem !== null && readerLoadingId === activeItem.id && !activeReader;

  const sanitizedContent = useMemo(() => {
    if (!activeItem) return '';
    const raw = activeReader?.content ?? activeItem.content ?? activeItem.summary ?? '<em>No content.</em>';
    return sanitizeHtml(raw);
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
    const trimmed = addUrl.trim();
    if (!trimmed || busy) return;
    if (!isSafeHttpUrl(trimmed)) {
      setError('Feed URL must be an http(s) URL.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.addFeed(trimmed);
      setAddUrl('');
      setAddOpen(false);
      await loadFeeds();
      await reloadItems();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function closeAdd() {
    setAddOpen(false);
    setAddUrl('');
  }

  useEffect(() => {
    if (addOpen) addInputRef.current?.focus();
  }, [addOpen]);

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
      const remaining = openTabs.filter((t) => t.feed_id !== id);
      setOpenTabs(remaining);
      if (activeItemId !== null && !remaining.some((t) => t.id === activeItemId)) {
        setActiveItemId(remaining[0]?.id ?? null);
      }
      await loadFeeds();
      await reloadItems();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleOpenItem(item: Item) {
    setActiveItemId(item.id);
    setOpenTabs((prev) => (prev.some((t) => t.id === item.id) ? prev : [...prev, item]));
    if (!item.read) {
      try {
        await api.setItemRead(item.id, true);
        const mark = (i: Item) => (i.id === item.id ? { ...i, read: 1 } : i);
        setItems((prev) => prev.map(mark));
        setOpenTabs((prev) => prev.map(mark));
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
      const mark = (i: Item) => (i.id === item.id ? { ...i, read: next ? 1 : 0 } : i);
      setItems((prev) => prev.map(mark));
      setOpenTabs((prev) => prev.map(mark));
      loadFeeds();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleMarkAllRead() {
    const feedId = selection.kind === 'feed' ? selection.id : undefined;
    try {
      await api.markAllRead(feedId);
      setOpenTabs((prev) =>
        prev.map((t) => (feedId === undefined || t.feed_id === feedId ? { ...t, read: 1 } : t))
      );
      await loadFeeds();
      await reloadItems();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function reorderTab(fromId: number, toId: number) {
    if (fromId === toId) return;
    setOpenTabs((prev) => {
      const fromIdx = prev.findIndex((t) => t.id === fromId);
      const toIdx = prev.findIndex((t) => t.id === toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved!);
      return next;
    });
  }

  useEffect(() => {
    if (!gridMode || !readerPaneVisible) return;
    let cancelled = false;
    for (const t of openTabs) {
      if (!safeHref(t.url)) continue;
      if (readerArticles[t.id] || readerErrors[t.id]) continue;
      api
        .getReaderArticle(t.id)
        .then((article) => {
          if (cancelled) return;
          setReaderArticles((prev) => ({ ...prev, [t.id]: article }));
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setReaderErrors((prev) => ({ ...prev, [t.id]: e.message }));
        });
    }
    return () => {
      cancelled = true;
    };
    // intentionally not depending on readerArticles/readerErrors to avoid loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridMode, readerPaneVisible, openTabs]);

  function closeTab(id: number) {
    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (id === activeItemId) {
        const fallback = next[idx] ?? next[idx - 1] ?? null;
        setActiveItemId(fallback ? fallback.id : null);
      }
      return next;
    });
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
            setOpenTabs((prev) => prev.map((t) => ({ ...t, read: 1 })));
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
            setOpenTabs((prev) => prev.map((t) => (t.feed_id === f.id ? { ...t, read: 1 } : t)));
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
        <button
          className={`pane-toggle topbar-sidebar-toggle ${sidebarCollapsed ? 'on' : ''}`}
          onClick={() => setSidebarCollapsed((v) => !v)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={sidebarCollapsed}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="9" y1="4" x2="9" y2="20" />
          </svg>
        </button>
        <h1>Feed Reader</h1>
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

      <div className={`body ${readerPaneVisible ? '' : 'no-reader'} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${sidebarCollapsed && addOpen ? 'force-expanded' : ''}`}>
          <div className="sidebar-header">
            <span className="sidebar-heading">Feeds</span>
            <button
              type="button"
              className={`sidebar-add ${addOpen ? 'on' : ''}`}
              onClick={() => (addOpen ? closeAdd() : setAddOpen(true))}
              aria-label={addOpen ? 'Cancel add feed' : 'Add feed'}
              aria-expanded={addOpen}
              title={addOpen ? 'Cancel' : 'Add feed'}
            >
              {addOpen ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              )}
            </button>
          </div>
          {addOpen && (
            <form className="sidebar-add-form" onSubmit={handleAddFeed}>
              <input
                ref={addInputRef}
                type="url"
                placeholder="https://example.com/feed.xml"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') closeAdd(); }}
                disabled={busy}
              />
              <button type="submit" disabled={busy || !addUrl.trim()}>Add</button>
            </form>
          )}
          <div
            className={`feed-item ${selection.kind === 'all' ? 'active' : ''}`}
            onClick={() => setSelection({ kind: 'all' })}
            onContextMenu={(e) => openMenu(e, allFeedsMenu())}
          >
            <span className="feed-avatar feed-avatar-all" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
              {totalUnread > 0 && <span className="feed-avatar-dot" />}
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
                {f.unread_count > 0 && <span className="feed-avatar-dot" />}
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
                {it.summary && (() => {
                  const preview = htmlToPlainText(it.summary);
                  return preview ? <div className="item-summary">{preview}</div> : null;
                })()}
              </li>
            ))}
            {items.length === 0 && <li className="empty">No items.</li>}
          </ul>
        </main>

        {readerPaneVisible && (
          <section className="reader" aria-label="Article reader">
            {openTabs.length > 0 && !gridMode && (
              <div className="reader-tabs" role="tablist" aria-label="Open articles">
                {openTabs.map((t) => (
                  <div
                    key={t.id}
                    role="tab"
                    aria-selected={t.id === activeItemId}
                    tabIndex={t.id === activeItemId ? 0 : -1}
                    className={`reader-tab ${t.id === activeItemId ? 'active' : ''} ${dragId === t.id ? 'dragging' : ''} ${dropTargetId === t.id && dragId !== null && dragId !== t.id ? 'drop-target' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      setDragId(t.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(t.id));
                    }}
                    onDragOver={(e) => {
                      if (dragId === null || dragId === t.id) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dropTargetId !== t.id) setDropTargetId(t.id);
                    }}
                    onDragLeave={() => {
                      if (dropTargetId === t.id) setDropTargetId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragId !== null) reorderTab(dragId, t.id);
                      setDragId(null);
                      setDropTargetId(null);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropTargetId(null);
                    }}
                    onClick={() => setActiveItemId(t.id)}
                    onAuxClick={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        closeTab(t.id);
                      }
                    }}
                    title={t.title ?? '(untitled)'}
                  >
                    <span className="reader-tab-title">{t.title ?? '(untitled)'}</span>
                    <button
                      type="button"
                      draggable={false}
                      className="reader-tab-close"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(t.id);
                      }}
                      aria-label="Close tab"
                      title="Close tab"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <header className="reader-pane-header">
              <div className="reader-pane-context" title={activeItem?.feed_url}>
                {activeItem ? (activeItem.feed_title ?? activeItem.feed_url) : 'Reader'}
              </div>
              <div className="reader-pane-actions">
                {activeItem && activeHref && (
                  <div className="reader-mode-toggle" role="group" aria-label="Reader mode">
                    <button
                      type="button"
                      className={!showOriginal ? 'on' : ''}
                      onClick={() => setShowOriginal(false)}
                      aria-pressed={!showOriginal}
                      title="Reader view"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="8" y1="13" x2="16" y2="13" />
                        <line x1="8" y1="17" x2="14" y2="17" />
                      </svg>
                      Reader
                    </button>
                    <button
                      type="button"
                      className={showOriginal ? 'on' : ''}
                      onClick={() => setShowOriginal(true)}
                      aria-pressed={showOriginal}
                      title="Original page"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                      Original
                    </button>
                  </div>
                )}
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
                {openTabs.length > 1 && (
                  <button
                    className={`pane-toggle ${gridMode ? 'on' : ''}`}
                    onClick={() => setGridMode((v) => !v)}
                    title={gridMode ? 'Single tab view' : 'Grid view'}
                    aria-label={gridMode ? 'Single tab view' : 'Grid view'}
                    aria-pressed={gridMode}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="3" width="8" height="8" rx="1" />
                      <rect x="13" y="3" width="8" height="8" rx="1" />
                      <rect x="3" y="13" width="8" height="8" rx="1" />
                      <rect x="13" y="13" width="8" height="8" rx="1" />
                    </svg>
                  </button>
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
            {gridMode && openTabs.length > 0 ? (
              <div className="reader-grid">
                {openTabs.map((t) => {
                  const tHref = safeHref(t.url);
                  const cached = readerArticles[t.id];
                  const tileRaw = cached?.content ?? t.content ?? t.summary ?? '<em>No content.</em>';
                  const tileHtml = sanitizeHtml(tileRaw);
                  const tileLoading = readerLoadingId === t.id && !cached;
                  return (
                    <div
                      key={t.id}
                      className={`reader-tile ${t.id === activeItemId ? 'active' : ''} ${dragId === t.id ? 'dragging' : ''} ${dropTargetId === t.id && dragId !== null && dragId !== t.id ? 'drop-target' : ''}`}
                      onClick={() => setActiveItemId(t.id)}
                      onDragOver={(e) => {
                        if (dragId === null || dragId === t.id) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dropTargetId !== t.id) setDropTargetId(t.id);
                      }}
                      onDragLeave={() => {
                        if (dropTargetId === t.id) setDropTargetId(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragId !== null) reorderTab(dragId, t.id);
                        setDragId(null);
                        setDropTargetId(null);
                      }}
                    >
                      <div
                        className="reader-tile-header"
                        draggable
                        onDragStart={(e) => {
                          setDragId(t.id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(t.id));
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setDropTargetId(null);
                        }}
                        title="Drag to reorder"
                      >
                        <svg className="reader-tile-grip" width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden="true">
                          <circle cx="3" cy="3" r="1" fill="currentColor" />
                          <circle cx="9" cy="3" r="1" fill="currentColor" />
                          <circle cx="3" cy="7" r="1" fill="currentColor" />
                          <circle cx="9" cy="7" r="1" fill="currentColor" />
                          <circle cx="3" cy="11" r="1" fill="currentColor" />
                          <circle cx="9" cy="11" r="1" fill="currentColor" />
                        </svg>
                        <span className="reader-tile-title">{t.title ?? '(untitled)'}</span>
                        {tHref && (
                          <a
                            className="reader-tile-link"
                            href={tHref}
                            target="_blank"
                            rel="noreferrer noopener"
                            onClick={(e) => e.stopPropagation()}
                            title="Open original"
                            aria-label="Open original"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M7 17L17 7M9 7h8v8" />
                            </svg>
                          </a>
                        )}
                        <button
                          type="button"
                          draggable={false}
                          className="reader-tile-close"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(t.id);
                          }}
                          aria-label="Close tile"
                          title="Close"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="reader-tile-meta">
                        <span className="reader-tile-feed">{t.feed_title ?? t.feed_url}</span>
                        {t.published_at && (
                          <time dateTime={new Date(t.published_at).toISOString()}>
                            {new Date(t.published_at).toLocaleString()}
                          </time>
                        )}
                      </div>
                      <div className="reader-tile-body">
                        {tileLoading ? (
                          <div className="reader-skeleton" aria-label="Loading article">
                            <div className="reader-skeleton-line" />
                            <div className="reader-skeleton-line" />
                            <div className="reader-skeleton-line" />
                            <div className="reader-skeleton-line" />
                          </div>
                        ) : (
                          <div
                            className="reader-content reader-tile-content"
                            dangerouslySetInnerHTML={{ __html: tileHtml }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
            <div className={`reader-pane-scroll ${showOriginal && activeHref ? 'original' : ''}`}>
              {activeItem && showOriginal && activeHref ? (
                <iframe
                  key={activeHref}
                  className="reader-original-frame"
                  src={activeHref}
                  title={activeItem.title ?? 'Original page'}
                  sandbox="allow-scripts allow-popups"
                  referrerPolicy="no-referrer"
                />
              ) : activeItem ? (
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
            )}
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
