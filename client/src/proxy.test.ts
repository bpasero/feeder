import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { proxyFetch, isProxyConfigured, proxyUrl } from './proxy';

const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

function mockFetch(handler: (input: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(typeof input === 'string' ? input : input.toString(), init);
  }) as unknown as typeof fetch;
}

describe('isProxyConfigured / proxyUrl', () => {
  it('returns false / empty when VITE_PROXY_URL is unset', () => {
    vi.stubEnv('VITE_PROXY_URL', '');
    expect(isProxyConfigured()).toBe(false);
    expect(proxyUrl()).toBe('');
  });

  it('returns true when set; strips trailing slash', () => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.example.com/');
    expect(isProxyConfigured()).toBe(true);
    expect(proxyUrl()).toBe('https://proxy.example.com');
  });
});

describe('proxyFetch', () => {
  it('throws a clear error when proxy is not configured', async () => {
    vi.stubEnv('VITE_PROXY_URL', '');
    await expect(proxyFetch('https://example.com/feed')).rejects.toThrow(/proxy not configured/i);
  });

  it('builds correct query URL and returns body + headers', async () => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.example.com');
    let capturedUrl = '';
    mockFetch((url) => {
      capturedUrl = url;
      return new Response('<rss/>', {
        status: 200,
        headers: {
          'Content-Type': 'application/xml',
          'X-Final-URL': 'https://final.example/feed',
        },
      });
    });
    const out = await proxyFetch('https://example.com/feed');
    expect(capturedUrl).toBe(
      'https://proxy.example.com/?url=' + encodeURIComponent('https://example.com/feed')
    );
    expect(out.body).toBe('<rss/>');
    expect(out.contentType).toBe('application/xml');
    expect(out.finalUrl).toBe('https://final.example/feed');
  });

  it('falls back to the original target when X-Final-URL is absent', async () => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.example.com');
    mockFetch(() => new Response('ok', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const out = await proxyFetch('https://example.com/article');
    expect(out.finalUrl).toBe('https://example.com/article');
  });

  it('surfaces an error with the upstream body on non-2xx', async () => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.example.com');
    mockFetch(() => new Response('refusing to fetch private/loopback host', { status: 400 }));
    await expect(proxyFetch('http://localhost/')).rejects.toThrow(/proxy 400.*private/i);
  });

  it('falls back to statusText if the error body is unreadable', async () => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.example.com');
    mockFetch(
      () =>
        new Response(null, { status: 502, statusText: 'Bad Gateway' }) // empty body
    );
    await expect(proxyFetch('https://example.com/')).rejects.toThrow(/proxy 502/);
  });
});
