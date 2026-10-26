export const MAX_URL_LENGTH = 4096;

/** Returns an absolute http(s) URL string, or null for anything else (javascript:, data:, rtmp:, ...). */
export function safeHttpUrl(raw: string, base?: string): string | null {
  const value = raw.trim();
  if (!value || value.length > MAX_URL_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.href;
}

export function isAbsoluteUrl(raw: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(raw.trim());
}

/** Scheme + host only. Used anywhere a URL could otherwise leak into logs or the UI. */
export function redactUrl(raw: string | undefined): string {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const ext = /\.([a-z0-9]{2,5})$/i.exec(u.pathname)?.[1];
    return `${u.protocol}//${u.host}/…${ext ? `.${ext}` : ''}`;
  } catch {
    return '[invalid url]';
  }
}

export function fileExtension(url: string): string {
  try {
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    return m ? m[1].toLowerCase() : '';
  } catch {
    return '';
  }
}
