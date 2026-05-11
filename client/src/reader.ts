import { Readability } from '@mozilla/readability';
import { proxyFetch } from './proxy';

export type ExtractedArticle = {
  title: string | null;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  content: string;
  length: number | null;
};

export async function extractReaderArticle(url: string): Promise<ExtractedArticle> {
  const { body, finalUrl } = await proxyFetch(url);

  const doc = new DOMParser().parseFromString(body, 'text/html');
  if (doc.head) {
    const base = doc.createElement('base');
    base.setAttribute('href', finalUrl);
    doc.head.insertBefore(base, doc.head.firstChild);
  }
  const parsed = new Readability(doc).parse();
  if (!parsed || !parsed.content) {
    throw new Error('Readability could not extract an article from this page');
  }
  return {
    title: parsed.title ?? null,
    byline: parsed.byline ?? null,
    siteName: parsed.siteName ?? null,
    excerpt: parsed.excerpt ?? null,
    content: parsed.content,
    length: parsed.length ?? null,
  };
}
