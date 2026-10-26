// Generates synthetic M3U catalogues. No real providers, URLs or credentials.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GROUPS = ['News', 'Sports', 'Movies', 'Kids', 'Music', 'Documentary', 'General', 'Movies;Series', 'Animation;Kids'];

export function syntheticCatalogue(count, { token = 'tok1', host = 'streams.example.invalid' } = {}) {
  const lines = ['#EXTM3U x-tvg-url="https://epg.example.invalid/guide.xml"'];
  for (let i = 0; i < count; i++) {
    const group = GROUPS[i % GROUPS.length];
    const name = `Synthetic Channel ${i}${i % 7 === 0 ? ', Extra' : ''}${i % 5 === 0 ? ' (720p)' : ''}`;
    const logo = i % 3 === 0 ? ` tvg-logo="https://logos.example.invalid/${i}.png"` : '';
    lines.push(`#EXTINF:-1 tvg-id="Synth${i}.xx@SD"${logo} group-title="${group}",${name}`);
    if (i % 50 === 0) lines.push('#EXTVLCOPT:http-user-agent=SyntheticAgent/1.0');
    lines.push(`https://${host}/live/${token}/${i}/index.m3u8`);
  }
  return lines.join('\r\n') + '\r\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'generated');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'synthetic-10000.m3u'), syntheticCatalogue(10000));
  writeFileSync(join(root, 'synthetic-10000-newtoken.m3u'), syntheticCatalogue(10000, { token: 'tok2' }));
  console.log(`Wrote fixtures to ${root}`);
}
