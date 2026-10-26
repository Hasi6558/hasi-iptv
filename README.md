# Hasi IPTV

A lightweight, remote-friendly IPTV web player for TV browsers (target: VIDAA). Import an M3U channel list, pick the channels you watch into **My Channels**, and watch them with only the arrow keys, OK and Back.

- React + TypeScript + Vite, plain CSS, no UI kit.
- One `<video>` element; native HLS when the browser reports it, otherwise [hls.js](https://github.com/video-dev/hls.js) loaded on demand (and the other engine is tried if the first fails).
- Catalogue in IndexedDB, preferences in localStorage. No backend, no accounts, no media proxy.
- Video goes directly from the provider to the TV.

## Commands

```bash
npm ci                 # install exact versions from package-lock.json
npm run dev            # dev server on http://localhost:5173
npm run build          # type-check + production build into dist/
npm run preview        # serve dist/ on http://localhost:4173
npm run serve:lan      # serve dist/ on your LAN (see "HTTP streams" below)
npm test               # unit tests (parser, reconciliation, storage, backup, player lifecycle, 10k perf)
npm run test:e2e       # keyboard-only Playwright E2E against the production build (run `npm run build` first)
npm run check          # all of the above
npm run fixtures       # writes synthetic 10,000-channel playlists to tests/fixtures/generated/
```

First E2E run only: `npx playwright install chromium`.

## Deploy to Vercel

The app is a static site; `vercel.json` already sets the build command, output directory and cache headers.

**Option A – Git (recommended, gives a stable URL):**
1. Push this folder to a GitHub/GitLab/Bitbucket repository.
2. In Vercel: **Add New… → Project → Import** the repository. Framework preset: *Vite* (detected). Keep the defaults (`npm run build`, output `dist`).
3. Deploy. Use the production domain (e.g. `https://hasi-iptv.vercel.app`) on the TV, **not** a preview URL.

**Option B – CLI:**
```bash
npx vercel login
npx vercel --prod
```

> Browser data belongs to one exact origin. Always open the same production URL on the TV; a preview deployment URL or a different domain starts with empty data (it is not lost, just stored under the other address).

## Using it on the TV

1. Open the production URL in the VIDAA browser. Bookmark it.
2. **Settings → Use public iptv-org playlist** (or type your own M3U URL → *Import URL*).
3. **All Channels**: search or pick a **Category**, move to a channel, press **→** to reach **☆ Add**, press OK. Repeat.
4. **My Channels** (the start screen): Up/Down to a channel, **OK** to watch.
5. In the player: OK shows the controls (the first OK never activates a button). **Prev / Next** follow your My Channels order and wrap around. **Back** or **☰ Channels** returns to the list while the channel keeps playing in the corner.
6. **Edit order** on My Channels shows **▲ Up / ▼ Down / Remove** on each row.
7. **Settings → Refresh source now** re-downloads the list. Saved channels are matched by provider ID and name, so a new token in the URL keeps your favourites. Channels that disappear stay in My Channels marked *Missing*; use **Find** to choose a replacement.
8. **Backups** (desktop browser recommended): *Export My Channels backup* has no URLs or tokens; *Export full backup* includes them. *Restore from file* previews the impact before changing anything.

### Remote keys

Only arrows, OK/Enter and Back/Escape/Backspace are required. If the TV's Back button navigates browser history instead of sending a key, the app also tries to catch that (not yet verified on the TV). **Settings → Stream Lab & diagnostics → Received keys** shows exactly what each remote button sends; colour/media keys are not used until confirmed on the device.

### Fullscreen

Full-window mode always works. *Fullscreen when a channel starts* (on by default) also requests real browser fullscreen for the whole app from the OK press, so lists remain usable while fullscreen. If the TV refuses, the app stays full-window and says so.

## Limits and troubleshooting

| Problem | Why | What you can do |
| --- | --- | --- |
| Playlist URL import fails | The provider doesn't send CORS headers, the link expired, or the network is down. Browsers don't say which. | Try the URL on a desktop browser; use *Import file* on desktop. |
| “HTTP stream blocked on HTTPS page” | `http://` streams from an `https://` site are blocked or auto-upgraded by the browser. | Use HTTPS streams, or run the app over HTTP on your LAN: `npm run build && npm run serve:lan`, then open `http://<your-PC-IP>:4173` on the TV (separate local data). |
| “Stream request blocked or unreachable” | hls.js needs CORS on the manifest, segments and keys. Geo-blocks look the same. | Set *Player engine* to *native* (native players don't need CORS) and retry; otherwise the provider doesn't support browser playback. |
| “Video format not supported” | Codec (often HEVC/H.265, AC-3) not supported by this browser. | None from the app; try another stream of the channel. |
| *Needs headers* badge | The playlist asks for `http-user-agent`/`http-referrer`, which browsers cannot send. | May not play; nothing to configure. |
| Single `.m3u8` imported as a source | That's a stream, not a channel list. | Test it in *Stream Lab*. |

Import limits (`src/lib/m3u/parser.ts` → `LIMITS`): 25 MB per playlist, 100,000 channels, names truncated at 200 characters. Backups: 40 MB.

### Privacy

Everything stays in this browser. The source URL (which may contain your username/password/token) is stored so the list can be refreshed; full backups contain it too. *Settings → Clear all local data* removes everything. Stream URLs are always visible to the device that plays them. The diagnostics panel shortens every URL to its host name.

## Project layout

```
src/app/                 App shell, focus/back handling, dialogs
src/features/catalogue/  All Channels, bounded paginated list, logos
src/features/my-channels My Channels, ordering, missing entries
src/features/player/     Playback controller (engines, retries, diagnosis), overlay, fullscreen
src/features/settings/   Import, backup/restore, clear data, Stream Lab diagnostics
src/lib/m3u/             Parser, format detection, fetch with limits
src/lib/storage/         IndexedDB repository + migrations, memory fallback, prefs, backups
src/lib/reconciliation/  Stable identity across refreshes
src/lib/navigation/      Remote keys, spatial focus, list stepping
src/workers/             Playlist parsing worker
tests/unit, tests/e2e    Vitest and Playwright; tests/fixtures holds synthetic data only
```

See `IMPLEMENTATION_STATUS.md` for what has been verified and what still needs testing on the TV.
