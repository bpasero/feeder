# Feed Reader

A local-first RSS / Atom / JSON Feed reader. Node + SQLite on the server, Vite + React on the client. Includes a Reader Mode that fetches the source article and runs Mozilla Readability for clean, distraction-free reading.

## Quick start

```bash
npm run install:all   # installs root, server, and client deps
npm run dev           # starts both processes via concurrently
```

Open <http://localhost:5173>. The server runs on port 3001.

On the very first launch (empty database) the server seeds six default feeds:

- Hacker News — `https://hnrss.org/frontpage`
- Lobste.rs — `https://lobste.rs/rss`
- The Verge — `https://www.theverge.com/rss/index.xml`
- Ars Technica — `https://feeds.arstechnica.com/arstechnica/index`
- Daring Fireball — `https://daringfireball.net/feeds/main`
- BBC News (Technology) — `https://feeds.bbci.co.uk/news/technology/rss.xml`

Subsequent restarts do not re-seed. To reset and re-seed, delete the SQLite files:

```bash
rm server/data.db server/data.db-shm server/data.db-wal
```

## Features

- Subscribe to any **RSS**, **Atom**, or **JSON Feed** URL.
- **Three-column layout:** feed sidebar / item list / reader pane. The reader pane is togglable via the top-right panel icon and the preference is persisted to `localStorage`.
- **Add-feed in the sidebar:** a compact `+` button in the sidebar header expands an inline URL input — no chrome at the top of the app. Esc cancels.
- **Reader Mode:** clicking an item triggers a background fetch of the source URL on the server, which runs `@mozilla/readability` over the parsed DOM and returns clean extracted content (title, byline, body). Results are cached per item in a `reader_articles` table.
- **Reader / Original toggle:** segmented control in the reader header. *Reader* shows the extracted article; *Original* renders the source page in a sandboxed iframe (`allow-scripts allow-popups allow-forms`, `no-referrer`). Choice is persisted as `showOriginal`. Sites that refuse to embed via `X-Frame-Options` / `frame-ancestors` can still be opened in a new tab with **Open original**.
- **Tabs:** each opened article becomes a tab in the reader pane. Middle-click closes a tab; the close (×) button shows on hover. Tabs survive switching feeds because each tab holds its own snapshot.
- **Drag and drop:**
  - Drag a tab in the strip to reorder it (dragged tab fades; drop target gets an accent indicator).
  - Toggle **Grid view** (shown when ≥2 tabs are open, persisted as `gridMode`) to render every open tab as a tile in a CSS auto-fit grid (`minmax(300px, 1fr)`). Drag a tile by its header to reorder. The active tile gets an accent border; the reader-pane actions (mark read, open original, reader/original) apply to it.
- **Light + dark theme** via `prefers-color-scheme` — no toggle required, OKLCH color tokens flip automatically.
- Per-feed unread counts, item read/unread state, bulk "Mark all read".
- Manual refresh per feed or all at once.
- **Context menus** (right-click) on every row:
  - **All feeds:** Refresh all · Mark everything as read.
  - **A feed:** Refresh · Mark all as read · Copy feed URL · Open homepage · Unsubscribe.
  - **An item:** Mark as read/unread · Open original · Copy article URL.

## Security

Defenses live in `server/src/feeds.ts` and `server/src/index.ts`:

- **SSRF:** scheme allowlist (http/https only), DNS-resolved private/loopback/link-local IP block, redirect cap of 5 with re-validation per hop.
- **CSRF:** middleware rejects state-changing requests when `Origin` is present and not on localhost.
- **XSS:** all feed and reader content sanitized via DOMPurify before rendering.
- **Fetch timeout:** every outbound HTTP call uses `AbortSignal.timeout(15000)`.
- **Input validation:** `limit` query param clamped 1…500, `mark-all-read` rejects invalid `feedId`.

## File layout

```
.
├── server/                # Hono + better-sqlite3 + Readability + jsdom
│   └── src/
│       ├── index.ts       # routes + CSRF middleware
│       ├── db.ts          # SQLite schema (feeds, items, reader_articles)
│       ├── feeds.ts       # SSRF-guarded fetch, RSS/Atom/JSON-Feed parsing
│       ├── reader.ts      # Readability extraction + caching
│       └── seed.ts        # default feeds on first run
├── client/                # Vite + React + TypeScript
│   └── src/
│       ├── App.tsx        # main UI
│       ├── api.ts         # typed API client
│       └── styles.css     # OKLCH-based light/dark theme
└── package.json           # root — `concurrently` runs both
```

## Scripts

| Command                | What it does                                |
| ---------------------- | ------------------------------------------- |
| `npm run install:all`  | Install root, server, and client deps       |
| `npm run dev`          | Run server (3001) + client (5173) together  |
| `npm run dev:server`   | Run only the server                         |
| `npm run dev:client`   | Run only the client                         |
| `npm run build`        | Production build of the client              |

## API

All endpoints are mounted under `/api`. State-changing endpoints (POST/PATCH/DELETE) require either no `Origin` header or one on `localhost`.

| Method | Path                                | Body / Query                          | Description                              |
| ------ | ----------------------------------- | ------------------------------------- | ---------------------------------------- |
| GET    | `/api/feeds`                        | —                                     | All feeds + unread/total counts          |
| POST   | `/api/feeds`                        | `{ url }`                             | Subscribe (fetches + parses)             |
| DELETE | `/api/feeds/:id`                    | —                                     | Unsubscribe                              |
| POST   | `/api/feeds/:id/refresh`            | —                                     | Re-fetch one feed                        |
| POST   | `/api/feeds/refresh-all`            | —                                     | Re-fetch every subscribed feed           |
| GET    | `/api/items`                        | `feedId?`, `unread=1?`, `limit≤500?`  | List items                               |
| PATCH  | `/api/items/:id`                    | `{ read: boolean }`                   | Mark read/unread                         |
| POST   | `/api/items/mark-all-read`          | `{ feedId? }`                         | Bulk mark — feed or everything           |
| GET    | `/api/items/:id/reader`             | `refresh=1?`                          | Reader-mode extracted article (cached)   |

## Requirements

- Node 18+ (Node 22 recommended)
- macOS, Linux, or Windows
