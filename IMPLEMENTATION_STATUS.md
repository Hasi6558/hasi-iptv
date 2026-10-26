# Implementation status

_Last updated: 2026-10-27._

**Summary:** Phases 1–5 are implemented and pass every automated check on desktop. **No test has been run on the VIDAA TV yet.** All TV-specific items below are **PENDING**, not passed. The Phase 1 acceptance gate (a real channel plays with audio on the target TV) is still open. The owner asked for the build to continue past the gate without waiting, so later phases were built on desktop evidence only.

Legend: ✅ done and verified on desktop · ⏳ pending (needs TV or an action from the owner) · ⚠️ known limitation

## Target device

| Item | Value |
| --- | --- |
| TV model | ⏳ unknown — please record |
| VIDAA / firmware version | ⏳ unknown |
| Browser user agent | ⏳ copy from *Stream Lab → Show text report* |
| Viewport / DPR | ⏳ |
| Native HLS / MSE / HEVC support | ⏳ (shown in Stream Lab) |
| Remote key values (arrows, OK, Back) | ⏳ (shown in *Received keys*) |
| Fullscreen behaviour | ⏳ |

## Phase 1 — Playback and TV compatibility prototype

- ✅ Vite + React + TypeScript scaffold, strict type-check, production build. Modern ES-module bundle plus a nomodule legacy bundle for older engines (`@vitejs/plugin-legacy`).
- ✅ Stream Lab (Settings → Stream Lab & diagnostics): URL input, Play, Stop, Full-window, Fullscreen.
- ✅ Native HLS detection (`canPlayType`), deferred hls.js (`import('hls.js')`), engine fallback, one engine instance, full cleanup on switch/stop/unmount.
- ✅ Diagnostics: capability table (MSE codecs, native HLS/MP4/TS/WebM, Fullscreen API, IndexedDB, localStorage, Worker, fetch/AbortController, ES modules), live video state, errors, channel-start timings, received keys, copyable text report. All URLs shortened to scheme + host.
- ✅ Error classes: unsupported/codec, blocked or unreachable (CORS cannot be told apart from other network failures — labelled uncertain), mixed content (http on https), provider HTTP status, timeout/stall, offline, DRM. Uncertain diagnoses are labelled “best guess”.
- ✅ Desktop verification (Chrome on Windows, real iptv-org streams): see *Real-provider smoke test*.
- ✅ Vercel config (`vercel.json`) and deployment steps (README).
- ⏳ **Deployment:** no Vercel CLI or login on the development machine, so nothing has been deployed. Owner action: follow README → *Deploy to Vercel*.
- ⏳ **Actual-TV test** (acceptance gate): playback with audio, Play/Stop, arrows/OK, fullscreen. See checklist below.

## Phase 2 — M3U import, storage and catalogue

- ✅ Parser: EXTINF attributes, names with commas (quote-aware), `group-title`/`#EXTGRP`, logos, BOM, CRLF/CR/LF, comments, malformed records with warnings, unnamed entries, bare URLs.
- ✅ Relative URLs resolved against the source URL; reported (and skipped) for file imports without a base.
- ✅ Detects single HLS media/master manifests and rejects them with a message. Records `#EXTVLCOPT`/`#KODIPROP`/`http-*` directives and shows a *Needs headers* badge.
- ✅ URL import with streaming progress, size limit (25 MB), cancellation; file import with size check; 100,000-entry limit.
- ✅ Parsing in a Web Worker (classic IIFE worker for older engines) with a chunked, yielding main-thread fallback.
- ✅ Versioned IndexedDB (`hasi-iptv` v1, explicit migration list), one transaction per import, batched writes inside the transaction, corrupt-record skipping, quota/blocked-storage messages, in-memory fallback with a visible warning.
- ✅ All Channels: bounded page of 40 rows, pagination, debounced (200 ms) search over pre-normalized names, category dialog (multi-groups `a;b` split), stable focus across pages; search/category/page are remembered.
- ✅ Synthetic 10,000-channel fixture (`npm run fixtures`, also generated inside the performance test). No real credentials anywhere in `tests/`.

## Phase 3 — My Channels and durable refresh

- ✅ Add/remove from All Channels with duplicate prevention; ★ Saved state on rows.
- ✅ Ordered My Channels with Edit order → ▲ Up / ▼ Down / Remove (no drag). Focus follows the moved row; a predictable neighbour is focused after removal.
- ✅ My Channels is the home screen; the last focused channel is restored after reload without autoplay (verified in E2E).
- ✅ Refresh reconciliation: unique provider ID → provider ID + name → stream URL → name + group → name. A key only matches when it is unique on both sides, so duplicated IDs never merge. Unmatched saved channels stay as *Missing*; ambiguous ones become *Needs review* (never substituted). Suspicious refreshes (under 20% of the previous size) need confirmation. Failed/cancelled imports change nothing.
- ✅ Personal backup (names/IDs/groups/order/settings, **no URLs**), optional full backup (warns it contains private URLs), validated restore with a preview; unmatched personal entries become placeholders that a later import re-matches.
- ✅ Clear all local data with a confirmation that names what will be deleted.

## Phase 4 — Viewing and remote UX

- ✅ Player overlay: name, list position, engine, notes; Prev, Play/Pause, Next, Channels, Fullscreen, Stop, Back. Prev/next follow the active list order (My Channels or the current All Channels result) and wrap around at both ends.
- ✅ Controls hide after 4 s only during healthy playback; the first OK while hidden only reveals them. Key-repeat OK is ignored.
- ✅ Spatial arrow navigation (deterministic tie-breaks), dialogs trap focus and Back closes the topmost one, focus restored per screen, text inputs keep Left/Right/Backspace, Tab still works on desktop. Back from the player returns to the list with the playing channel focused.
- ✅ Playback continues in a corner mini view while browsing; “Now playing” in the sidebar; playing state shown separately from focus.
- ✅ Fullscreen requested synchronously in the OK/click handler; rejection is caught and full-window stays; `fullscreenchange` (and the webkit variant) tracked. Rejected `play()` shows an explicit Play button.
- ✅ Immediate loading feedback; 350 ms debounce for Prev/Next zapping; request IDs stop stale callbacks; bounded retries (2) with backoff; start timeout (20 s, 12 s when another engine is left to try); stall timeout (20 s); automatic retry when the network comes back or the page becomes visible again.
- ✅ Removing the currently playing channel keeps playback; Prev/Next continue from its former position.
- ✅ Phone layout (375 px, no horizontal scroll — E2E), desktop keyboard, high-contrast yellow focus ring.
- ⏳ TV readability at viewing distance, remote behaviour, Back-key/history behaviour.

## Phase 5 — Performance, reliability and release

- ✅ Automated checks: `npm run check` (type-check, 68 unit tests, build, 4 E2E tests) passes.
- ✅ Leak checks (unit): 20 rapid switches leave exactly one hls.js instance for the latest channel; stop/destroy remove the engine, `src` and every listener.
- ✅ Failure cases covered by tests: 404/HTTP errors, network/CORS-like errors, mixed content, codec errors (one `recoverMediaError` then fail), autoplay refusal, stalls, missing channels, failed refresh (existing data kept), corrupt storage records, failed transactions roll back, invalid/unsafe backups, missing logos (fallback initials, no retry loop).
- ⏳ One hour of continuous viewing and repeated switching **on the TV**.
- ⏳ Production deployment (owner action, see README).
- ⚠️ Simulated E2E uses Playwright Chromium with synthetic WebM media served by request interception. This is not TV or real-provider evidence.

## Measured results (desktop only)

Machine: Windows 11 development PC, Node 22, Chrome (installed) / Playwright Chromium 156.

| Metric | Result |
| --- | --- |
| Initial JS (modern bundle) | **95.2 KB gzip** (304.6 KB min) + 2.7 KB CSS — target < 150 KB ✅ |
| hls.js chunk (deferred, first HLS play only) | 179 KB gzip |
| Legacy bundle (only for engines without ES modules) | 103 KB + 57 KB polyfills gzip |
| Parse worker | 5.1 KB |
| Real iptv-org import (11,331 channels, 2.5 MB) | 1.5–1.9 s total; longest main-thread task **51 ms** after batching IndexedDB writes (was 227 ms) |
| Reload to My Channels with 11k cached | 148–281 ms |
| Synthetic 10k: worst 500-line parse slice | 5.3 ms |
| Synthetic 10k: reconcile a token change | 77 ms (main thread) |
| Search over 10k | 2.5 ms per query |
| Rendered rows | 40 per page (284 pages for 11k) |

### Real-provider smoke test (desktop Chrome, public iptv-org list, 2026-10-27)

| Channel | Native engine (auto) | hls.js forced |
| --- | --- | --- |
| 4TV News (576p) | played, 3.1 s | played, 1.6 s |
| 7 News (720p) | HTTP 404 shown (after native → hls.js fallback) | HTTP 404 shown |
| 9 Plus News (1080p) | played, 2.6 s | played, 1.0 s |
| 22Scope News (1080p) | played, 3.1 s | played, 1.6 s |
| 24 News (576p) | — | played, 4.1 s |

8 rapid Next presses with hls.js ended on the right channel (position 9 of 343) with one video element. These public streams change often; the results show the player works, not that these channels will stay available.

## Known limitations

- ⚠️ 2,290 of the 11,331 iptv-org entries use `http://`. From the HTTPS Vercel site, browsers block or auto-upgrade them, so many will fail. Workaround: `npm run serve:lan` and open `http://<PC-IP>:4173` on the TV (separate local data).
- ⚠️ 726 iptv-org entries ask for custom User-Agent/Referer headers, which browsers cannot send (9 more use non-HTTP schemes and are skipped). They are imported with a *Needs headers* badge and may fail.
- ⚠️ CORS failures cannot be told apart from geo-blocks or offline servers in a browser; the message says so.
- ⚠️ Local data is per browser and per exact origin; nothing syncs between devices.
- ⚠️ TV browsers may not support file upload/download; backups are mainly for desktop.
- ⚠️ Reconciliation runs on the main thread (77 ms for 10k on desktop; probably several times longer on a TV). Move it into the worker if the TV shows a visible pause while saving.
- ⚠️ hls.js buffer settings (30 s forward, 30 s back, 40 MB) are conservative defaults, not yet tuned on the TV.
- ⚠️ If the TV only supports the video element's own fullscreen, the custom overlay may be hidden there; full-window mode is the fallback.

## TV test checklist (please report results)

1. Open the deployed URL (or the LAN URL) in the VIDAA browser.
2. Settings → **Stream Lab & diagnostics** → **Show text report**. Send the report (it contains no stream addresses), plus TV model and software version.
3. On the same screen press each remote key (arrows, OK, Back, and optionally Play/Pause, channel up/down, colour keys) and note the *Received keys* rows.
4. Settings → **Use public iptv-org playlist**. Note the import time and whether the UI froze.
5. All Channels → search “news” → play 5 HTTPS channels. For each: plays? audio? start time? engine shown in the player?
6. Try Settings → *Player engine*: native vs hls.js on a channel that failed.
7. In the player: does OK reveal the controls? Do Prev/Next work? Does **Fullscreen** fill the screen? Does Back return to the list (or leave the site)?
8. Add 5 channels to My Channels, reorder, reload the page: are order and focus kept?
9. Leave one channel playing for an hour: still playing? Any slowdown afterwards?

## Next step

The owner deploys (README → *Deploy to Vercel*) and runs the TV checklist. Then add any observed remote key codes, set the build target from the reported browser version, and tune buffer/retry settings from the TV results.
