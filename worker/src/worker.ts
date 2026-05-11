/// <reference types="@cloudflare/workers-types" />

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB

const ALLOWED_ORIGINS = new Set<string>([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://bpasero.github.io',
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'X-Final-URL',
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

// `new URL("http://[::ffff:127.0.0.1]/").hostname` → "[::ffff:7f00:1]".
// The URL parser keeps IPv4-mapped IPv6 in compressed hex form, so the dotted
// quad isn't visible to our IPv4 regex. Unpack the trailing 32 bits back to
// dotted form so we can run them through `isPrivateIp` for real.
function ipv4MappedToDotted(lower: string): string | null {
  if (!lower.startsWith('::ffff:')) return null;
  const rest = lower.slice(7);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(rest)) return rest;
  const m = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!m) return null;
  const hi = parseInt(m[1], 16);
  const lo = parseInt(m[2], 16);
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isPrivateIp(host: string): boolean {
  const m4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m4) {
    const a = Number(m4[1]);
    const b = Number(m4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
    return false;
  }
  const lower = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:')) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  const mapped = ipv4MappedToDotted(lower);
  if (mapped) return isPrivateIp(mapped);
  return false;
}

function isUnsafeHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;
  if (isPrivateIp(h)) return true;
  return false;
}

async function safeFetch(target: string): Promise<{ res: Response; finalUrl: string } | Response> {
  let current = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return new Response('invalid url', { status: 400 });
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return new Response(`unsupported scheme: ${u.protocol}`, { status: 400 });
    }
    if (isUnsafeHost(u.hostname)) {
      return new Response('refusing to fetch private/loopback host', { status: 400 });
    }
    let upstream: Response;
    try {
      upstream = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': 'feed-reader-proxy/0.1 (+https://github.com/bpasero/claude-one)',
          Accept:
            'application/json, application/feed+json, application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.85, */*;q=0.8',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      return new Response(`upstream fetch failed: ${(err as Error).message}`, { status: 502 });
    }
    if (upstream.status >= 300 && upstream.status < 400) {
      const loc = upstream.headers.get('location');
      if (!loc) return new Response('redirect with no location', { status: 502 });
      try {
        current = new URL(loc, current).toString();
      } catch {
        return new Response('invalid redirect location', { status: 502 });
      }
      continue;
    }
    return { res: upstream, finalUrl: current };
  }
  return new Response('too many redirects', { status: 502 });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }
    if (request.method !== 'GET') {
      return new Response('method not allowed', { status: 405, headers: corsHeaders(origin) });
    }
    const target = url.searchParams.get('url');
    if (!target) {
      return new Response('missing url query param', { status: 400, headers: corsHeaders(origin) });
    }

    const result = await safeFetch(target);
    if (result instanceof Response) {
      const headers = new Headers(result.headers);
      for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
      return new Response(result.body, { status: result.status, headers });
    }
    const { res, finalUrl } = result;

    const lenHeader = res.headers.get('content-length');
    if (lenHeader && Number(lenHeader) > MAX_BODY_BYTES) {
      return new Response('upstream response too large', { status: 502, headers: corsHeaders(origin) });
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) {
      return new Response('upstream response too large', { status: 502, headers: corsHeaders(origin) });
    }

    const headers: Record<string, string> = {
      ...corsHeaders(origin),
      'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
      'X-Final-URL': finalUrl,
      'Cache-Control': 'no-store',
    };
    return new Response(buf, { status: res.status, headers });
  },
};
