import DOMPurify from 'dompurify';

// Force rel="noopener noreferrer" on any anchor with a `target` attribute.
// Without this, a feed can render `<a target="_blank">` and the new tab gets
// `window.opener` access to our page — classic tabnabbing / phishing pivot.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'A' && node.hasAttribute('target')) {
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function sanitizeHtml(raw: string): string {
  return DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
