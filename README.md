# Feed Reader

A static, **serverless RSS / Atom / JSON Feed reader**. The whole app is a
single-page Vite + React build that runs entirely in the browser, storing
feeds, items, and Reader Mode articles in IndexedDB. The only piece of
backend is a ~150-line Cloudflare Worker that proxies outbound feed and
article fetches so the browser can get around CORS.

```
┌──────────────────────────────┐         ┌────────────────────────────┐
│  GitHub Pages (static SPA)   │ ──────▶ │  Cloudflare Worker proxy   │ ──▶ feeds
│  IndexedDB, Readability,     │         │  SSRF-guarded GET-only     │
│  feed parsing — all in-browser│         └────────────────────────────┘
└──────────────────────────────┘
```

## Quick start (local dev)

```bash
npm run install:all   # installs root, client, and worker deps
# Deploy the Worker first (see "Deploy the Worker"), then:
echo "VITE_PROXY_URL=https://feed-reader-proxy.<account>.workers.dev" > client/.env.local
npm run dev           # vite on http://localhost:5173
```

On first load with an empty IndexedDB, the client subscribes to six default
feeds (Hacker News, Lobste.rs, The Verge, Ars Technica, Daring Fireball, BBC
Tech). To reset, clear site data in DevTools → Application → Storage.

## Deploy the Worker

The Worker proxies fetches with SSRF protection (private-IP block, redirect
cap, scheme allowlist, 15s timeout, 10 MB body cap). See
[`worker/README.md`](worker/README.md) for the full spec.

```bash
cd worker
npm install
npx wrangler login           # one-time
npm run deploy
```

Wrangler prints the deployed URL — e.g.
`https://feed-reader-proxy.<account>.workers.dev`. That's the value you wire
into the client as `VITE_PROXY_URL`.

## Deploy the SPA to GitHub Pages

The repo ships a workflow at `.github/workflows/deploy.yml` that builds the
client and publishes it via `actions/deploy-pages`.

1. In GitHub: **Settings → Pages → Build and deployment → Source = GitHub
   Actions**.
2. **Settings → Secrets and variables → Actions → Variables → New repository
   variable**: `VITE_PROXY_URL` = your deployed Worker URL.
3. Push to `main`. The action builds with `base: '/claude-one/'` and serves
   the SPA at `https://<user>.github.io/claude-one/`.

The Vite base path is hardcoded to `/claude-one/` to match this repo name —
edit `client/vite.config.ts` if you fork to a differently-named repo.

## Features

- Subscribe to any **RSS**, **Atom**, or **JSON Feed** URL. Parsed
  client-side with `DOMParser`.
- **Three-column layout:** feed sidebar / item list / reader pane. The
  reader pane is togglable via the top-right panel icon and the preference
  is persisted to `localStorage`.
- **Collapsible sidebar:** the top-left panel icon collapses the feed
  sidebar to a thin rail of avatars (unread feeds get an accent dot).
  Hovering or keyboard-focusing the rail expands the full sidebar as an
  overlay above the item list. Opening the inline "+" add-feed form keeps
  the sidebar expanded.
- **Reader Mode:** clicking an item triggers a fetch of the source URL
  through the Worker proxy, then runs `@mozilla/readability` in the
  browser. Extracted articles are cached in IndexedDB (`reader_articles`).
- **Reader / Original toggle:** segmented control in the reader header.
  *Reader* shows the extracted article; *Original* renders the source page
  in a sandboxed iframe.
- **Tabs + grid view:** every opened article becomes a tab; toggle Grid
  view (≥2 tabs) to see them as tiles. Drag to reorder.
- **Light + dark theme** via `prefers-color-scheme` — OKLCH tokens flip
  automatically.
- Per-feed unread counts, item read/unread state, bulk "Mark all read".
- Manual refresh per feed or all at once.
- **Context menus** (right-click) on feeds and items.

## Security

The only network-exposed piece is the Worker. Defenses in `worker/src/worker.ts`:

- **SSRF:** scheme allowlist (http/https only), hostname checks block
  literal private/loopback IP ranges, `localhost`, `*.local`, `*.internal`,
  `*.localhost`. Redirect cap of 5 with re-validation per hop.
- **Method allowlist:** only `GET` and `OPTIONS` reach upstream.
- **Resource limits:** 15s upstream timeout, 10 MB body cap.
- **CORS:** open (`Access-Control-Allow-Origin: *`). The proxy carries no
  auth and no cookies, so an open public proxy is acceptable for this use.

The client sanitizes all rendered feed and reader content with DOMPurify
before injecting into the DOM.

## File layout

```
.
├── client/                    # Vite + React + TypeScript
│   ├── src/
│   │   ├── App.tsx            # main UI
│   │   ├── api.ts             # facade over store + proxy + parser + reader
│   │   ├── store.ts           # IndexedDB wrapper (feeds, items, reader_articles)
│   │   ├── parser.ts          # RSS / Atom / JSON Feed parsing via DOMParser
│   │   ├── reader.ts          # @mozilla/readability extraction
│   │   ├── proxy.ts           # client wrapper around the Worker proxy
│   │   ├── seed.ts            # default feed list for first-run
│   │   └── styles.css         # OKLCH light/dark theme
│   └── vite.config.ts         # base = '/claude-one/' in production
├── worker/                    # Cloudflare Worker (CORS / SSRF-guarded proxy)
│   └── src/worker.ts
├── .github/workflows/
│   └── deploy.yml             # builds client, deploys to GitHub Pages
└── package.json               # root scripts
```

## Scripts

| Command                | What it does                                            |
| ---------------------- | ------------------------------------------------------- |
| `npm run install:all`  | Install root, client, and worker deps                   |
| `npm run dev`          | Run the Vite dev server (5173)                          |
| `npm run build`        | Production build of the client (`client/dist/`)         |
| `npm run preview`      | Preview the production build locally                    |
| `npm run worker:dev`   | Run the Worker locally via `wrangler dev`               |
| `npm run worker:deploy`| Deploy the Worker to your Cloudflare account            |

## Requirements

- Node 20+
- A Cloudflare account (Workers free tier is plenty)
