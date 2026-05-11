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
- Rejects hostnames matching private/loopback IP ranges (including
  `100.64.0.0/10` CGNAT and IPv4-mapped IPv6 like `[::ffff:7f00:1]`),
  `localhost`, `*.local`, `*.internal`, `*.localhost`. URL parser
  normalization handles alternate IPv4 encodings (decimal, hex, octal).
- Follows up to 5 redirects, re-validating the host on every hop.
- 15s upstream timeout. 10 MB body cap.
- **Origin allowlist:** `Access-Control-Allow-Origin` is sent only when the
  request's `Origin` header matches an entry in `ALLOWED_ORIGINS` at the top
  of `src/worker.ts`. Non-browser clients (curl, scripts) — which omit the
  `Origin` header — work fine without it. CORS does not stop server-side
  abuse; combine with Cloudflare WAF rate-limiting if that matters.

## Deploy

```bash
cd worker
npm install
npx wrangler login           # one-time
npm run deploy
```

Note the deployed URL printed by Wrangler (looks like
`https://feed-reader-proxy.<your-subdomain>.workers.dev`). Set this as the
client's `VITE_PROXY_URL` — for GitHub Pages, add it as a repo variable
(Settings → Secrets and variables → Actions → Variables → New variable
`VITE_PROXY_URL`). For local dev put it in `client/.env.local`:

```
VITE_PROXY_URL=https://feed-reader-proxy.<your-subdomain>.workers.dev
```

If you fork this repo, edit `ALLOWED_ORIGINS` in `src/worker.ts` to include
your GitHub Pages origin (e.g. `https://<your-user>.github.io`) and redeploy.

## Local dev

```bash
npm run dev    # wrangler dev — runs the worker on localhost:8787
```
