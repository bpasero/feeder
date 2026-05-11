import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'data.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    title TEXT,
    site_url TEXT,
    description TEXT,
    last_fetched_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    guid TEXT NOT NULL,
    title TEXT,
    url TEXT,
    author TEXT,
    content TEXT,
    summary TEXT,
    published_at INTEGER,
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE(feed_id, guid)
  );

  CREATE INDEX IF NOT EXISTS idx_items_feed_published ON items(feed_id, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_items_read ON items(read);

  CREATE TABLE IF NOT EXISTS reader_articles (
    item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    title TEXT,
    byline TEXT,
    site_name TEXT,
    excerpt TEXT,
    content TEXT NOT NULL,
    length INTEGER,
    fetched_at INTEGER NOT NULL
  );
`);

export type FeedRow = {
  id: number;
  url: string;
  title: string | null;
  site_url: string | null;
  description: string | null;
  last_fetched_at: number | null;
  created_at: number;
};

export type ReaderArticleRow = {
  item_id: number;
  title: string | null;
  byline: string | null;
  site_name: string | null;
  excerpt: string | null;
  content: string;
  length: number | null;
  fetched_at: number;
};

export type ItemRow = {
  id: number;
  feed_id: number;
  guid: string;
  title: string | null;
  url: string | null;
  author: string | null;
  content: string | null;
  summary: string | null;
  published_at: number | null;
  read: number;
  created_at: number;
};
