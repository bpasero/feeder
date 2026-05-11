import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { fetchAsText } from './feeds.js';
import { db, type ReaderArticleRow } from './db.js';

export type ExtractedArticle = {
  title: string | null;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  content: string;
  length: number | null;
};

export async function extractReaderArticle(url: string): Promise<ExtractedArticle> {
  const { body, finalUrl } = await fetchAsText(url);

  const dom = new JSDOM(body, { url: finalUrl });
  const reader = new Readability(dom.window.document);
  const parsed = reader.parse();
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

const insertReader = db.prepare(`
  INSERT INTO reader_articles (item_id, title, byline, site_name, excerpt, content, length, fetched_at)
  VALUES (@item_id, @title, @byline, @site_name, @excerpt, @content, @length, @fetched_at)
  ON CONFLICT(item_id) DO UPDATE SET
    title      = excluded.title,
    byline     = excluded.byline,
    site_name  = excluded.site_name,
    excerpt    = excluded.excerpt,
    content    = excluded.content,
    length     = excluded.length,
    fetched_at = excluded.fetched_at
`);

const selectReader = db.prepare('SELECT * FROM reader_articles WHERE item_id = ?');

export function getCachedReader(itemId: number): ReaderArticleRow | undefined {
  return selectReader.get(itemId) as ReaderArticleRow | undefined;
}

export function saveReader(itemId: number, article: ExtractedArticle): ReaderArticleRow {
  insertReader.run({
    item_id: itemId,
    title: article.title,
    byline: article.byline,
    site_name: article.siteName,
    excerpt: article.excerpt,
    content: article.content,
    length: article.length,
    fetched_at: Date.now(),
  });
  return selectReader.get(itemId) as ReaderArticleRow;
}
