import { isAbsoluteUrl, MAX_URL_LENGTH, safeHttpUrl } from './url';

/** Documented import limits. Keep in sync with README "Limits". */
export const LIMITS = {
  maxPlaylistBytes: 25 * 1024 * 1024,
  maxEntries: 100_000,
  maxNameLength: 200,
  maxGroupLength: 200,
  maxWarningsKept: 200,
};

export type ParsedEntry = {
  providerId?: string;
  name: string;
  group?: string;
  logoUrl?: string;
  streamUrl: string;
  directives?: string[];
  line: number;
};

export type WarningCode =
  | 'missing-header'
  | 'missing-url'
  | 'url-without-extinf'
  | 'unsupported-scheme'
  | 'relative-url-no-base'
  | 'invalid-url'
  | 'invalid-logo'
  | 'unnamed'
  | 'name-truncated'
  | 'provider-directives'
  | 'malformed-extinf'
  | 'entry-limit';

export type ParseWarning = { code: WarningCode; line: number; message: string };

export type PlaylistKind = 'catalogue' | 'media-manifest' | 'empty';

export type ParseResult = {
  kind: PlaylistKind;
  entries: ParsedEntry[];
  warnings: ParseWarning[];
  /** Counts per warning code, including warnings beyond maxWarningsKept. */
  warningCounts: Partial<Record<WarningCode, number>>;
  totalLines: number;
};

export type ParseOptions = { baseUrl?: string };

// Tags that only appear in HLS media/master manifests, never in channel catalogues.
const HLS_MANIFEST_TAGS = ['#EXT-X-STREAM-INF', '#EXT-X-TARGETDURATION', '#EXT-X-MEDIA-SEQUENCE', '#EXT-X-PLAYLIST-TYPE'];
// Request header directives a browser cannot set for media requests.
const HEADER_ATTRS = ['http-user-agent', 'http-referrer', 'http-referer', 'http-origin', 'http-header'];

type Pending = {
  line: number;
  attrs: Record<string, string>;
  name: string;
  group?: string;
  directives: Set<string>;
};

/** Splits `#EXTINF:` content into the attribute part and the title, honouring quoted commas. */
export function splitExtinf(body: string): { head: string; title: string } | null {
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) return { head: body.slice(0, i), title: body.slice(i + 1) };
  }
  return null;
}

const ATTR_RE = /([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g;

export function parseAttributes(head: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(head))) attrs[m[1].toLowerCase()] = m[2];
  return attrs;
}

function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last ? `${u.hostname} ${decodeURIComponent(last)}` : u.hostname;
  } catch {
    return 'Unnamed channel';
  }
}

/**
 * Incremental M3U catalogue parser. Call step() repeatedly so the caller can
 * yield between chunks (main-thread fallback) or report progress (worker).
 */
export class M3UParser {
  private readonly lines: string[];
  private index = 0;
  private pending: Pending | null = null;
  private manifestTags = 0;
  private sawHeader = false;
  private readonly entries: ParsedEntry[] = [];
  private readonly warnings: ParseWarning[] = [];
  private readonly counts: Partial<Record<WarningCode, number>> = {};
  private stopped = false;

  constructor(
    text: string,
    private readonly options: ParseOptions = {},
  ) {
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    this.lines = clean.split(/\r\n|\n|\r/);
  }

  get progress(): number {
    return this.lines.length ? this.index / this.lines.length : 1;
  }

  get totalLines(): number {
    return this.lines.length;
  }

  /** Processes up to maxLines lines. Returns true when parsing is complete. */
  step(maxLines: number): boolean {
    const end = Math.min(this.lines.length, this.index + maxLines);
    while (this.index < end && !this.stopped) {
      this.handleLine(this.lines[this.index].trim(), this.index + 1);
      this.index++;
    }
    if (this.stopped) this.index = this.lines.length;
    return this.index >= this.lines.length;
  }

  result(): ParseResult {
    if (this.pending) {
      this.warn('missing-url', this.pending.line, `“${this.pending.name}” has no stream URL`);
      this.pending = null;
    }
    let kind: PlaylistKind = 'catalogue';
    if (this.manifestTags > 0) kind = 'media-manifest';
    else if (this.entries.length === 0) kind = 'empty';
    if (kind === 'catalogue' && !this.sawHeader) {
      this.warn('missing-header', 1, 'File does not start with #EXTM3U; parsed anyway');
    }
    return {
      kind,
      entries: kind === 'catalogue' ? this.entries : [],
      warnings: this.warnings,
      warningCounts: this.counts,
      totalLines: this.lines.length,
    };
  }

  private warn(code: WarningCode, line: number, message: string) {
    this.counts[code] = (this.counts[code] ?? 0) + 1;
    if (this.warnings.length < LIMITS.maxWarningsKept) this.warnings.push({ code, line, message });
  }

  private handleLine(line: string, lineNo: number) {
    if (!line) return;
    if (line.charAt(0) === '#') {
      this.handleTag(line, lineNo);
      return;
    }
    this.handleUrl(line, lineNo);
  }

  private handleTag(line: string, lineNo: number) {
    const upper = line.slice(0, 24).toUpperCase();
    if (upper.startsWith('#EXTM3U')) {
      this.sawHeader = true;
      return;
    }
    if (upper.startsWith('#EXTINF:')) {
      if (this.pending) {
        this.warn('missing-url', this.pending.line, `“${this.pending.name}” has no stream URL`);
      }
      this.pending = this.parseExtinf(line.slice(8), lineNo);
      return;
    }
    for (const tag of HLS_MANIFEST_TAGS) {
      if (upper.startsWith(tag)) {
        this.manifestTags++;
        return;
      }
    }
    if (!this.pending) return;
    if (upper.startsWith('#EXTGRP:')) {
      if (!this.pending.group) this.pending.group = line.slice(8).trim().slice(0, LIMITS.maxGroupLength);
    } else if (upper.startsWith('#EXTVLCOPT:') || upper.startsWith('#KODIPROP:')) {
      const opt = line.slice(line.indexOf(':') + 1);
      const key = opt.split('=')[0].trim().toLowerCase();
      if (key) this.pending.directives.add(key);
    }
    // Any other #-line is a comment or unknown tag and is ignored.
  }

  private parseExtinf(body: string, lineNo: number): Pending {
    const split = splitExtinf(body);
    let head = body;
    let title = '';
    if (split) {
      head = split.head;
      title = split.title.trim();
    } else {
      this.warn('malformed-extinf', lineNo, 'EXTINF line has no title separator');
    }
    const attrs = parseAttributes(head);
    const directives = new Set<string>();
    for (const key of HEADER_ATTRS) if (attrs[key]) directives.add(key);
    let name = title || attrs['tvg-name'] || '';
    if (!name) {
      this.warn('unnamed', lineNo, 'Channel without a name');
    } else if (name.length > LIMITS.maxNameLength) {
      this.warn('name-truncated', lineNo, 'Channel name truncated');
      name = name.slice(0, LIMITS.maxNameLength);
    }
    const group = attrs['group-title']?.trim().slice(0, LIMITS.maxGroupLength) || undefined;
    return { line: lineNo, attrs, name, group, directives };
  }

  private handleUrl(raw: string, lineNo: number) {
    const pending = this.pending;
    this.pending = null;
    if (this.entries.length >= LIMITS.maxEntries) {
      this.warn('entry-limit', lineNo, `Stopped after ${LIMITS.maxEntries} channels`);
      this.stopped = true;
      return;
    }
    const label = pending?.name ? `“${pending.name}”` : `Line ${lineNo}`;
    if (raw.length > MAX_URL_LENGTH) {
      this.warn('invalid-url', lineNo, `${label}: URL too long`);
      return;
    }
    let streamUrl: string | null;
    if (isAbsoluteUrl(raw)) {
      streamUrl = safeHttpUrl(raw);
      if (!streamUrl) {
        const scheme = raw.slice(0, raw.indexOf(':')).toLowerCase();
        if (scheme === 'http' || scheme === 'https') this.warn('invalid-url', lineNo, `${label}: invalid URL`);
        else this.warn('unsupported-scheme', lineNo, `${label}: ${scheme}: streams are not playable in a browser`);
        return;
      }
    } else if (this.options.baseUrl) {
      streamUrl = safeHttpUrl(raw, this.options.baseUrl);
      if (!streamUrl) {
        this.warn('invalid-url', lineNo, `${label}: invalid relative URL`);
        return;
      }
    } else {
      this.warn('relative-url-no-base', lineNo, `${label}: relative URL cannot be resolved for a file import`);
      return;
    }

    if (!pending) this.warn('url-without-extinf', lineNo, `Line ${lineNo}: URL without #EXTINF; name derived from URL`);
    const attrs = pending?.attrs ?? {};
    let logoUrl: string | undefined;
    if (attrs['tvg-logo']) {
      logoUrl = safeHttpUrl(attrs['tvg-logo'], this.options.baseUrl) ?? undefined;
      if (!logoUrl) this.warn('invalid-logo', lineNo, `${label}: logo URL ignored`);
    }
    const directives = pending ? Array.from(pending.directives) : [];
    if (directives.length) {
      this.warn('provider-directives', pending!.line, `${label}: requires ${directives.join(', ')} which browsers cannot send`);
    }
    const entry: ParsedEntry = {
      name: pending?.name || nameFromUrl(streamUrl),
      streamUrl,
      line: pending?.line ?? lineNo,
    };
    const providerId = attrs['tvg-id']?.trim();
    if (providerId) entry.providerId = providerId;
    if (pending?.group) entry.group = pending.group;
    if (logoUrl) entry.logoUrl = logoUrl;
    if (directives.length) entry.directives = directives;
    this.entries.push(entry);
  }
}

/** Synchronous convenience wrapper, used by tests and small inputs. */
export function parseM3U(text: string, options: ParseOptions = {}): ParseResult {
  const parser = new M3UParser(text, options);
  parser.step(Number.MAX_SAFE_INTEGER);
  return parser.result();
}

/** Human-readable explanation for non-catalogue inputs. */
export function describeKind(kind: PlaylistKind): string {
  if (kind === 'media-manifest') {
    return 'This is a single HLS stream manifest, not a channel list. Use Stream Lab (Settings → Stream Lab) to test it.';
  }
  if (kind === 'empty') return 'No playable channels were found in this playlist.';
  return '';
}
