import { describe, expect, it } from 'vitest';
import { parseM3U, splitExtinf, LIMITS } from '../../src/lib/m3u/parser';
import { identityName, normalizeName, splitGroups } from '../../src/lib/m3u/normalize';
import { redactUrl, safeHttpUrl } from '../../src/lib/m3u/url';

describe('parseM3U', () => {
  it('parses attributes, groups, logos and names containing commas', () => {
    const r = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-id="a.us" tvg-logo="https://l.example/a.png" group-title="News, World",Alpha, The Channel\nhttps://s.example/a.m3u8\n',
    );
    expect(r.kind).toBe('catalogue');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({
      providerId: 'a.us',
      name: 'Alpha, The Channel',
      group: 'News, World',
      logoUrl: 'https://l.example/a.png',
      streamUrl: 'https://s.example/a.m3u8',
    });
  });

  it('handles BOM, CRLF, CR-only line endings, blank lines and comments', () => {
    const text = '﻿#EXTM3U\r\n# a comment\r\n\r\n#EXTINF:-1,One\r\nhttp://x.example/1\r#EXTINF:-1,Two\rhttp://x.example/2';
    const r = parseM3U(text);
    expect(r.entries.map((e) => e.name)).toEqual(['One', 'Two']);
    expect(r.warnings.find((w) => w.code === 'missing-header')).toBeUndefined();
  });

  it('warns about malformed records without dropping good ones', () => {
    const text = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="x"', // no comma: malformed, still uses following URL
      'https://ok.example/x',
      '#EXTINF:-1,No URL here',
      '#EXTINF:-1,Bad scheme',
      'rtmp://live.example/app',
      '#EXTINF:-1 tvg-logo="javascript:alert(1)",Bad logo',
      'https://ok.example/y',
      '#EXTINF:-1,',
      'https://ok.example/z',
      'https://ok.example/bare',
    ].join('\n');
    const r = parseM3U(text);
    expect(r.entries.map((e) => e.streamUrl)).toEqual(['https://ok.example/x', 'https://ok.example/y', 'https://ok.example/z', 'https://ok.example/bare']);
    expect(r.entries[1].logoUrl).toBeUndefined();
    expect(r.warningCounts['malformed-extinf']).toBe(1);
    expect(r.warningCounts['missing-url']).toBe(1);
    expect(r.warningCounts['unsupported-scheme']).toBe(1);
    expect(r.warningCounts['invalid-logo']).toBe(1);
    expect(r.warningCounts['unnamed']).toBe(2);
    expect(r.warningCounts['url-without-extinf']).toBe(1);
  });

  it('never accepts javascript: or data: stream URLs', () => {
    const r = parseM3U('#EXTM3U\n#EXTINF:-1,X\njavascript:alert(1)\n#EXTINF:-1,Y\ndata:text/html,hi\n');
    expect(r.entries).toHaveLength(0);
    expect(r.kind).toBe('empty');
  });

  it('resolves relative URLs against the source URL', () => {
    const r = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-logo="../logo.png",Rel\nlive/1.m3u8\n', { baseUrl: 'https://p.example/lists/main.m3u' });
    expect(r.entries[0].streamUrl).toBe('https://p.example/lists/live/1.m3u8');
    expect(r.entries[0].logoUrl).toBe('https://p.example/logo.png');
  });

  it('reports relative URLs in file imports without a base', () => {
    const r = parseM3U('#EXTM3U\n#EXTINF:-1,Rel\nlive/1.m3u8\n');
    expect(r.entries).toHaveLength(0);
    expect(r.warningCounts['relative-url-no-base']).toBe(1);
  });

  it('detects a single HLS media or master manifest', () => {
    const media = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:6.0,\nseg1.ts\n';
    expect(parseM3U(media, { baseUrl: 'https://x.example/a.m3u8' }).kind).toBe('media-manifest');
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow.m3u8\n';
    expect(parseM3U(master, { baseUrl: 'https://x.example/a.m3u8' }).kind).toBe('media-manifest');
  });

  it('records provider header directives the browser cannot honour', () => {
    const r = parseM3U(
      '#EXTM3U\n#EXTINF:-1 http-referrer="https://r.example",A\n#EXTVLCOPT:http-user-agent=Foo\nhttps://s.example/a\n#EXTINF:-1,B\n#KODIPROP:inputstream.adaptive.license_type=x\nhttps://s.example/b\n',
    );
    expect(r.entries[0].directives?.sort()).toEqual(['http-referrer', 'http-user-agent']);
    expect(r.entries[1].directives).toEqual(['inputstream.adaptive.license_type']);
    expect(r.warningCounts['provider-directives']).toBe(2);
  });

  it('uses #EXTGRP when group-title is absent and truncates overlong names', () => {
    const long = 'N'.repeat(LIMITS.maxNameLength + 50);
    const r = parseM3U(`#EXTM3U\n#EXTINF:-1,${long}\n#EXTGRP:Films\nhttps://s.example/a\n`);
    expect(r.entries[0].group).toBe('Films');
    expect(r.entries[0].name).toHaveLength(LIMITS.maxNameLength);
  });

  it('splitExtinf ignores commas inside quoted attributes', () => {
    expect(splitExtinf('-1 group-title="a,b",Name, x')).toEqual({ head: '-1 group-title="a,b"', title: 'Name, x' });
  });
});

describe('normalization', () => {
  it('normalizes names for search', () => {
    expect(normalizeName('  Télé-Québec  HD! ')).toBe('tele quebec hd');
    expect(normalizeName('1+1 International')).toBe('1+1 international');
    expect(normalizeName('Россия 24')).toBe('россия 24');
  });
  it('builds identity names without volatile suffixes', () => {
    expect(identityName('Alpha News (720p) [Geo-blocked]')).toBe('alpha news');
    expect(identityName('Alpha News (1080p)')).toBe(identityName('Alpha News'));
  });
  it('splits multi-groups', () => {
    expect(splitGroups('Movies;Series')).toEqual(['Movies', 'Series']);
    expect(splitGroups(undefined)).toEqual([]);
  });
});

describe('url helpers', () => {
  it('accepts only http(s)', () => {
    expect(safeHttpUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(safeHttpUrl('ftp://a.example/x')).toBeNull();
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
  });
  it('redacts paths, queries and credentials', () => {
    const r = redactUrl('http://user:pass@host.example:8080/get.php?username=u&password=p&type=m3u');
    expect(r).toBe('http://host.example:8080/….php');
    expect(r).not.toContain('pass');
    expect(redactUrl('https://cdn.example/live/token123/index.m3u8')).toBe('https://cdn.example/….m3u8');
  });
});
