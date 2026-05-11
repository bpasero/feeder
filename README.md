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

## How the no-server architecture works

Originally this app shipped a Node + SQLite server. It was rewritten to be
fully static so it can live on GitHub Pages. Everything the old server did
now happens client-side:

| Old (Node server)                       | New (browser)                                       |
| --------------------------------------- | --------------------------------------------------- |
| SQLite (`better-sqlite3`)               | IndexedDB (`client/src/store.ts`)                   |
| `rss-parser` + XML parsing in Node      | `DOMParser` + custom parser (`client/src/parser.ts`)|
| `@mozilla/readability` + `jsdom`        | `@mozilla/readability` over `DOMParser` documents   |
| `fetch()` from Node (no CORS)           | `fetch()` through a Cloudflare Worker proxy         |
| Node SSRF guards, redirect cap, timeout | Same guards, ported into the Worker                 |

The one piece that **can't** live in the browser is the outbound feed
fetch — most RSS endpoints don't send `Access-Control-Allow-Origin`, so a
GH-Pages-hosted SPA can't `fetch()` them directly. A ~150-line Cloudflare
Worker handles those fetches and returns the body with permissive CORS.
The Worker is the *only* thing that needs an account anywhere; the rest is
flat files served by GitHub.

## Quick start (local dev)

```bash
npm run install:all                      # root, client, and worker deps

# Terminal 1 — local Worker on :8787
npm run worker:dev

# Terminal 2 — Vite on :5173, pointed at the local worker
echo "VITE_PROXY_URL=http://localhost:8787" > client/.env.local
npm run dev
```

Open <http://localhost:5173>. On first load with an empty IndexedDB the
client subscribes to six default feeds (Hacker News, Lobste.rs, The Verge,
Ars Technica, Daring Fireball, BBC Tech). To reset, clear site data in
DevTools → Application → Storage.

`client/.env.local` is gitignored. For production builds the GH Actions
workflow reads `VITE_PROXY_URL` from a repo variable instead (see below).

## Deploying for real

The deploy is two independent moving parts:

1. **Cloudflare Worker** — the CORS proxy (one-time setup + redeploy on
   change). Lives at `https://feed-reader-proxy.<subdomain>.workers.dev`.
2. **GitHub Pages** — the static SPA. A push to `main` rebuilds and
   redeploys via `.github/workflows/deploy.yml`.

### 1. Deploy the Worker to Cloudflare

The Worker proxies fetches with SSRF protection (private-IP block, redirect
cap, scheme allowlist, 15s timeout, 10 MB body cap). Full spec in
[`worker/README.md`](worker/README.md).

```bash
cd worker
npm install
npx wrangler login           # opens browser → authorize with your CF account
npm run deploy
```

> **One-time:** after your first Workers deploy, Cloudflare will warn
> *"You need to register a workers.dev subdomain before publishing"*. Open
> <https://dash.cloudflare.com/> → **Workers & Pages** → **Overview** and
> pick a subdomain (e.g. `bpasero` → `bpasero.workers.dev`). No redeploy
> needed — the existing upload becomes reachable immediately.

The Worker URL is `https://feed-reader-proxy.<your-subdomain>.workers.dev`.
You'll wire this into the client in step 2.

#### Validate the Worker

```bash
URL=https://feed-reader-proxy.<your-subdomain>.workers.dev
FEED=https%3A%2F%2Fhnrss.org%2Ffrontpage

curl -s "$URL/health"; echo                                                                            # {"ok":true}
curl -s "$URL/?url=$FEED" | head -c 200; echo                                                          # <rss …>
curl -sI -H "Origin: https://bpasero.github.io" "$URL/?url=$FEED" | grep -i access-control-allow-origin # echoes the allowed origin
curl -sI -H "Origin: https://evil.example"      "$URL/?url=$FEED" | grep -i access-control-allow-origin # (no output — not allowlisted)
curl -s -o /dev/null -w "%{http_code}\n" "$URL/?url=http%3A%2F%2Flocalhost%2F"                          # 400 (SSRF blocked)
curl -s -o /dev/null -w "%{http_code}\n" "$URL/?url=http%3A%2F%2F%5B%3A%3Affff%3A7f00%3A1%5D%2F"        # 400 (IPv4-mapped IPv6 blocked)
```

The Worker only sets `Access-Control-Allow-Origin` for browser requests from
allowlisted origins (`http://localhost:5173`, `http://127.0.0.1:5173`,
`https://bpasero.github.io` — edit `worker/src/worker.ts` to change). Non-
browser clients (curl, scripts) work without a CORS header.

### 2. Deploy the SPA to GitHub Pages

1. **Settings → Pages → Build and deployment → Source = GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables → New repository
   variable**: `VITE_PROXY_URL` = your Worker URL from step 1.
3. Push to `main` (or click *Run workflow* on
   [`Deploy to GitHub Pages`](../../actions/workflows/deploy.yml)). The
   workflow builds with `base: '/claude-one/'` and publishes to
   `https://<user>.github.io/claude-one/`.

If you fork to a differently-named repo, edit the `base` in
`client/vite.config.ts` to match.

#### Validate the SPA end-to-end

Open the deployed URL with DevTools → Network. Feed requests should be
`GET https://feed-reader-proxy.<…>.workers.dev/?url=…` returning `200 OK`
with `access-control-allow-origin: *`. No CORS errors in the console. The
sidebar should populate after the six default feeds finish fetching.

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
