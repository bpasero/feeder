# Feed Reader CORS proxy (Cloudflare Worker)

A tiny Cloudflare Worker that proxies HTTP(S) `GET` requests for the client.
Most RSS feeds don't send `Access-Control-Allow-Origin`, so a static
GitHub-Pages-hosted client can't fetch them directly. This Worker does the
fetch on the edge and returns the body with permissive CORS.

## Behavior

- `GET /?url=<encoded url>` — fetches `url`, returns the upstream body and
  `Content-Type`. Sets `X-Final-URL` to the resolved URL after redirects.
- `GET /health` — `{"ok": true}`.
- Rejects schemes other than `http:` / `https:`.
- Rejects hostnames matching private IP ranges, `localhost`, `*.local`,
  `*.internal`, `*.localhost`.
- Follows up to 5 redirects, re-validating the host on every hop.
- 15s upstream timeout. 10 MB body cap.
- Sends `Access-Control-Allow-Origin: *` — the Worker carries no auth or
  cookies, so an open proxy is fine for this use.

## Deploy

```bash
cd worker
npm install
npx wrangler login           # one-time
npm run deploy
```

Note the deployed URL printed by Wrangler (looks like
`https://feed-reader-proxy.<your-account>.workers.dev`). Set this as the
client's `VITE_PROXY_URL` — for GitHub Pages, add it as a repo variable
(Settings → Secrets and variables → Actions → Variables → New variable
`VITE_PROXY_URL`). For local dev put it in `client/.env.local`:

```
VITE_PROXY_URL=https://feed-reader-proxy.<your-account>.workers.dev
```

## Local dev

```bash
npm run dev    # wrangler dev — runs the worker on localhost:8787
```
