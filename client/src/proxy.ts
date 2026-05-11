// Resolves the upstream Cloudflare Worker URL. Configured via VITE_PROXY_URL.
const RAW = (import.meta.env.VITE_PROXY_URL as string | undefined) ?? '';
const PROXY_URL = RAW.replace(/\/$/, '');

export function isProxyConfigured(): boolean {
  return PROXY_URL.length > 0;
}

export function proxyUrl(): string {
  return PROXY_URL;
}

export async function proxyFetch(target: string): Promise<{ body: string; contentType: string; finalUrl: string }> {
  if (!isProxyConfigured()) {
    throw new Error('Feed proxy not configured. Set VITE_PROXY_URL to the deployed Cloudflare Worker URL.');
  }
  const u = `${PROXY_URL}/?url=${encodeURIComponent(target)}`;
  const res = await fetch(u, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`proxy ${res.status}: ${text || res.statusText}`);
  }
  const body = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  const finalUrl = res.headers.get('x-final-url') ?? target;
  return { body, contentType, finalUrl };
}
