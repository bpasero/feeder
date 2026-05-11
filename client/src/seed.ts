export const DEFAULT_FEEDS = [
  'https://hnrss.org/frontpage',
  'https://lobste.rs/rss',
  'https://www.theverge.com/rss/index.xml',
  'https://feeds.arstechnica.com/arstechnica/index',
  'https://daringfireball.net/feeds/main',
  'https://feeds.bbci.co.uk/news/technology/rss.xml',
];

export async function seedDefaultFeedsIfEmpty(
  subscribe: (url: string) => Promise<void>
): Promise<void> {
  await Promise.allSettled(DEFAULT_FEEDS.map((url) => subscribe(url)));
}
