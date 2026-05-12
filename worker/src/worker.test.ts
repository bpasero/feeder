import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { corsHeaders, ipv4MappedToDotted, isPrivateIp, isUnsafeHost } from './worker';

// ---------- helpers ----------

function req(input: string, init?: RequestInit): Request {
  return new Request(input, init);
}

function mockFetch(handler: (input: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(typeof input === 'string' ? input : input.toString(), init);
  }) as unknown as typeof fetch;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---------- isPrivateIp ----------

describe('isPrivateIp — IPv4 ranges', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.255.255.255', true],
    ['0.0.0.0', true],
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['192.168.0.1', true],
    ['192.168.1.42', true],
    ['172.16.0.0', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['172.15.255.255', false],
    ['169.254.169.254', true], // AWS/GCP/Azure metadata
    ['169.254.0.0', true],
    ['100.64.0.1', true], // CGNAT lower
    ['100.127.255.255', true], // CGNAT upper
    ['100.63.255.255', false], // just below CGNAT
    ['100.128.0.1', false], // just above CGNAT
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['203.0.113.1', false],
  ])('isPrivateIp(%s) === %s', (host, expected) => {
    expect(isPrivateIp(host)).toBe(expected);
  });
});

describe('isPrivateIp — IPv6', () => {
  it.each([
    ['::1', true],
    ['::', true],
    ['fe80::1', true],
    ['fe80::abcd', true],
    ['fc00::1', true],
    ['fd12:3456::1', true],
    ['2001:db8::1', false],
    ['2606:4700::1111', false], // Cloudflare DNS
  ])('isPrivateIp(%s) === %s', (host, expected) => {
    expect(isPrivateIp(host)).toBe(expected);
  });

  it('handles bracketed IPv6', () => {
    expect(isPrivateIp('[::1]')).toBe(true);
    expect(isPrivateIp('[2001:db8::1]')).toBe(false);
  });
});

describe('isPrivateIp — IPv4-mapped IPv6', () => {
  it('rejects loopback in dotted form', () => {
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
  });

  it('rejects loopback in compressed hex form (the new gap)', () => {
    expect(isPrivateIp('::ffff:7f00:1')).toBe(true);
  });

  it('rejects private ranges in hex form', () => {
    expect(isPrivateIp('::ffff:c0a8:101')).toBe(true); // 192.168.1.1
    expect(isPrivateIp('::ffff:a00:1')).toBe(true); // 10.0.0.1
  });

  it('allows public IPv4 in mapped form', () => {
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
    expect(isPrivateIp('::ffff:808:808')).toBe(false);
  });
});

// ---------- ipv4MappedToDotted ----------

describe('ipv4MappedToDotted', () => {
  it.each([
    ['::ffff:127.0.0.1', '127.0.0.1'],
    ['::ffff:7f00:1', '127.0.0.1'],
    ['::ffff:0808:0808', '8.8.8.8'],
    ['::ffff:c0a8:101', '192.168.1.1'],
  ])('unpacks %s → %s', (input, expected) => {
    expect(ipv4MappedToDotted(input)).toBe(expected);
  });

  it('returns null for non-mapped IPv6', () => {
    expect(ipv4MappedToDotted('::1')).toBeNull();
    expect(ipv4MappedToDotted('2001:db8::1')).toBeNull();
    expect(ipv4MappedToDotted('fe80::1')).toBeNull();
  });

  it('returns null for unparseable mapped form', () => {
    expect(ipv4MappedToDotted('::ffff:gibberish')).toBeNull();
  });
});

// ---------- isUnsafeHost ----------

describe('isUnsafeHost', () => {
  it.each([
    ['localhost', true],
    ['LOCALHOST', true], // case-insensitive
    ['foo.local', true],
    ['kubernetes.internal', true],
    ['example.localhost', true],
    ['example.com', false],
    ['google.com', false],
    ['127.0.0.1', true], // via isPrivateIp
    ['10.0.0.1', true],
    ['8.8.8.8', false],
  ])('isUnsafeHost(%s) === %s', (host, expected) => {
    expect(isUnsafeHost(host)).toBe(expected);
  });
});

// ---------- corsHeaders ----------

describe('corsHeaders', () => {
  it('omits Access-Control-Allow-Origin when origin is null', () => {
    const h = corsHeaders(null);
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
    expect(h['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
    expect(h.Vary).toBe('Origin');
  });

  it('omits Access-Control-Allow-Origin for unknown origin', () => {
    const h = corsHeaders('https://evil.example');
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('echoes the origin when allowlisted', () => {
    expect(corsHeaders('https://bpasero.github.io')['Access-Control-Allow-Origin'])
      .toBe('https://bpasero.github.io');
    expect(corsHeaders('http://localhost:5173')['Access-Control-Allow-Origin'])
      .toBe('http://localhost:5173');
    expect(corsHeaders('http://127.0.0.1:5173')['Access-Control-Allow-Origin'])
      .toBe('http://127.0.0.1:5173');
  });
});

// ---------- handler ----------

describe('handler — basic routing', () => {
  it('returns 204 with CORS headers for OPTIONS', async () => {
    const res = await worker.fetch(req('https://proxy.example/', {
      method: 'OPTIONS',
      headers: { Origin: 'https://bpasero.github.io' },
    }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://bpasero.github.io');
  });

  it('returns 204 without origin header for unknown origin', async () => {
    const res = await worker.fetch(req('https://proxy.example/', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('responds to /health', async () => {
    const res = await worker.fetch(req('https://proxy.example/health'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/json/);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('rejects POST', async () => {
    const res = await worker.fetch(req('https://proxy.example/?url=https://example.com', { method: 'POST' }));
    expect(res.status).toBe(405);
  });

  it('returns 400 when url query is missing', async () => {
    const res = await worker.fetch(req('https://proxy.example/'));
    expect(res.status).toBe(400);
    await expect(res.text()).resolves.toMatch(/missing url/i);
  });
});

describe('handler — SSRF guards', () => {
  beforeEach(() => mockFetch(() => new Response('should never be called', { status: 200 })));

  it.each([
    ['file:///etc/passwd', /unsupported scheme/i],
    ['ftp://example.com/feed', /unsupported scheme/i],
    ['http://localhost/feed', /private\/loopback/i],
    ['http://127.0.0.1/feed', /private\/loopback/i],
    ['http://10.0.0.1/feed', /private\/loopback/i],
    ['http://[::1]/feed', /private\/loopback/i],
    ['http://[::ffff:7f00:1]/feed', /private\/loopback/i],
    ['http://2130706433/feed', /private\/loopback/i], // decimal form → 127.0.0.1
    ['http://0x7f000001/feed', /private\/loopback/i], // hex form → 127.0.0.1
  ])('blocks %s', async (target, expected) => {
    const res = await worker.fetch(req(`https://proxy.example/?url=${encodeURIComponent(target)}`));
    expect(res.status).toBe(400);
    await expect(res.text()).resolves.toMatch(expected);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns 400 for an unparseable URL', async () => {
    const res = await worker.fetch(req('https://proxy.example/?url=not-a-url'));
    expect(res.status).toBe(400);
  });
});

describe('handler — happy path', () => {
  it('returns the upstream body with content-type and X-Final-URL', async () => {
    mockFetch(() =>
      new Response('<rss version="2.0"><channel/></rss>', {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      })
    );
    const res = await worker.fetch(req(
      'https://proxy.example/?url=https%3A%2F%2Fexample.com%2Ffeed',
      { headers: { Origin: 'https://bpasero.github.io' } }
    ));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/xml');
    expect(res.headers.get('X-Final-URL')).toBe('https://example.com/feed');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://bpasero.github.io');
    await expect(res.text()).resolves.toContain('<rss version="2.0">');
  });

  it('omits Access-Control-Allow-Origin for disallowed origins', async () => {
    mockFetch(() => new Response('ok', { status: 200 }));
    const res = await worker.fetch(req(
      'https://proxy.example/?url=https%3A%2F%2Fexample.com%2F',
      { headers: { Origin: 'https://attacker.example' } }
    ));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('forwards GET method and accepts header', async () => {
    let captured: RequestInit | undefined;
    mockFetch((_url, init) => {
      captured = init;
      return new Response('ok', { status: 200 });
    });
    await worker.fetch(req('https://proxy.example/?url=https%3A%2F%2Fexample.com%2F'));
    expect(captured?.method).toBe('GET');
    expect((captured?.headers as Record<string, string>).Accept).toMatch(/rss|atom|json/);
  });
});

describe('handler — redirects', () => {
  it('follows 302 to a public target and reports X-Final-URL', async () => {
    let hits = 0;
    mockFetch((url) => {
      hits++;
      if (url === 'https://example.com/feed') {
        return new Response(null, { status: 302, headers: { Location: 'https://final.example/' } });
      }
      return new Response('done', { status: 200 });
    });
    const res = await worker.fetch(req(
      'https://proxy.example/?url=https%3A%2F%2Fexample.com%2Ffeed'
    ));
    expect(hits).toBe(2);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Final-URL')).toBe('https://final.example/');
  });

  it('blocks a redirect to a private IP', async () => {
    mockFetch((url) => {
      if (url === 'https://example.com/feed') {
        return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } });
      }
      return new Response('should not reach', { status: 200 });
    });
    const res = await worker.fetch(req(
      'https://proxy.example/?url=https%3A%2F%2Fexample.com%2Ffeed'
    ));
    expect(res.status).toBe(400);
    await expect(res.text()).resolves.toMatch(/private\/loopback/i);
  });

  it('returns 502 on redirect missing Location header', async () => {
    mockFetch(() => new Response(null, { status: 301 }));
    const res = await worker.fetch(req(
      'https://proxy.example/?url=https%3A%2F%2Fexample.com%2F'
    ));
    expect(res.status).toBe(502);
    await expect(res.text()).resolves.toMatch(/redirect/i);
  });

  it('returns 502 after too many redirects', async () => {
    let count = 0;
    mockFetch(() => {
      count++;
      return new Response(null, { status: 302, headers: { Location: `https://example.com/hop${count}` } });
    });
    const res = await worker.fetch(req(
      'https://proxy.example/?url=https%3A%2F%2Fexample.com%2Fstart'
    ));
    expect(res.status).toBe(502);
    await expect(res.text()).resolves.toMatch(/too many redirects/i);
    expect(count).toBeGreaterThan(5);
  });

  it('resolves relative redirect locations', async () => {
    mockFetch((url) => {
      if (url === 'https://example.com/feed') {
        return new Response(null, { status: 302, headers: { Location: '/new-path' } });
      }
      expect(url).toBe('https://example.com/new-path');
      return new Response('ok', { status: 200 });
    });
    const res = await worker.fetch(req(
      'https://proxy.example/?url=https%3A%2F%2Fexample.com%2Ffeed'
    ));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Final-URL')).toBe('https://example.com/new-path');
  });
});

describe('handler — error + size handling', () => {
  it('returns 502 when upstream fetch throws', async () => {
    mockFetch(() => {
      throw new Error('network down');
    });
    const res = await worker.fetch(req('https://proxy.example/?url=https%3A%2F%2Fexample.com%2F'));
    expect(res.status).toBe(502);
    await expect(res.text()).resolves.toMatch(/upstream fetch failed/i);
  });

  it('returns 502 when upstream Content-Length exceeds cap', async () => {
    mockFetch(() => new Response('hi', {
      status: 200,
      headers: { 'Content-Length': String(11 * 1024 * 1024) },
    }));
    const res = await worker.fetch(req('https://proxy.example/?url=https%3A%2F%2Fexample.com%2F'));
    expect(res.status).toBe(502);
    await expect(res.text()).resolves.toMatch(/too large/i);
  });

  it('returns 502 when actual body exceeds cap (no Content-Length)', async () => {
    const oversized = new Uint8Array(11 * 1024 * 1024);
    mockFetch(() => new Response(oversized, { status: 200 }));
    const res = await worker.fetch(req('https://proxy.example/?url=https%3A%2F%2Fexample.com%2F'));
    expect(res.status).toBe(502);
    await expect(res.text()).resolves.toMatch(/too large/i);
  });

  it('forwards a non-2xx upstream status with body', async () => {
    mockFetch(() => new Response('not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    }));
    const res = await worker.fetch(req('https://proxy.example/?url=https%3A%2F%2Fexample.com%2F'));
    expect(res.status).toBe(404);
    await expect(res.text()).resolves.toBe('not found');
  });
});
