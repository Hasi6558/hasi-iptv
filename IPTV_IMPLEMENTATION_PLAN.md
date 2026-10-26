# Lightweight IPTV Web Player — Implementation Plan

## Instructions for Claude Code

Build a lightweight, remote-friendly IPTV web player for a resource-constrained VIDAA TV browser. Follow the phases below in order. This document is the implementation specification, not a claim that compatibility has already been verified.

1. Inspect the existing repository and its instructions before making changes. Preserve unrelated work. If the repository is empty, scaffold the stack below.
2. Implement Phase 1 first and produce a runnable compatibility prototype. Provide deployment instructions or use an already authorized deployment workflow.
3. Request actual-TV playback and remote-key results before treating the compatibility gate as passed. Continue independent parser/storage work if useful, but do not claim TV support based on desktop tests.
4. After compatibility is confirmed, implement the remaining phases in order without requesting approval for routine implementation choices.
5. Maintain `IMPLEMENTATION_STATUS.md` with completed tasks, validation results, unresolved limitations and the next step. Mark unavailable hardware tests as pending, never passed.
6. Use current official documentation, pin dependencies in the lockfile, and avoid speculative TV APIs or undocumented remote codes.
7. Keep changes focused. Do not add accounts, cloud services, media proxies, transcoding or unrelated features without a demonstrated need.

## 1. Goal and user journey

The user has an IPTV M3U URL containing many channels. They want to select regularly watched channels, save them in a personal ordered playlist, and easily select, play and fullscreen those channels on their TV.

Daily flow: open website → My Channels → select a channel using arrows → press OK → watch. The large source catalogue is mainly for adding channels, not daily navigation.

Primary device: VIDAA TV browser, exact model and firmware initially unknown. Secondary devices: desktop and mobile for testing and optional local setup. Local data does not automatically sync between devices.

## 2. Scope and architecture

| Component | Decision |
| --- | --- |
| Frontend | React + TypeScript + Vite; plain CSS; minimal dependencies |
| Hosting | Static build on Vercel |
| Playback | One HTML video element; native HLS when usable, otherwise dynamically load hls.js |
| Catalogue storage | IndexedDB, accessed behind a small repository interface |
| Preferences | Small localStorage records with failure handling |
| Playlist parsing | Dedicated parser; Web Worker for large imports; chunked fallback |
| Navigation | Explicit focus management using arrows and Enter/OK |
| Backend | None in the baseline implementation |
| Media delivery | Provider directly to the TV browser |

One source URL and one ordered personal playlist named **My Channels** are sufficient for version one. Model sources and playlists with IDs so later expansion does not require a storage rewrite.

Excluded from version one: EPG, recording, catch-up, subscriptions, accounts, cloud sync, automatic transcoding, multi-stream previews, service-worker caching of media, and installing or replacing TV firmware.

## 3. Compatibility and security boundaries

- An M3U channel catalogue and an HLS media manifest are different things, even though both may use M3U syntax. Detect the input type and show a useful message if a single HLS manifest is supplied to the catalogue importer.
- URL extensions are hints, not definitive format detection. Extensionless HLS endpoints exist. Probe within browser capabilities; handle errors clearly.
- hls.js needs compatible MediaSource APIs and codecs. Native playback also depends on the device. Do not promise every `.ts`, HEVC or provider-specific stream will work.
- Browser fetching requires suitable CORS responses from the provider. With hls.js this includes nested manifests, segments and encryption keys where applicable.
- HTTPS-hosted pages may reject HTTP-only resources. Do not promise that a client-side setting can bypass browser security.
- File import can avoid CORS for the catalogue itself; it does not fix CORS or codec problems for video streams.
- Headers specified in provider-specific M3U directives may be unsupported or forbidden in browser requests. Detect such directives and report limitations; do not silently claim compatibility.
- Do not build an open URL proxy. If a backend becomes necessary, document the reason and design separately with authentication, host restrictions, redirect validation, timeouts, response-size limits and SSRF protection.
- A Vercel function is not an indefinite live video relay. Hosting the UI does not require routing video through Vercel.
- Never commit private URLs, credentials, real playlist fixtures or tokens. Never place them in analytics, console logs, routes or error reports.
- Store user-supplied sources locally only as needed for refresh. Explain in Settings that browser storage and full backups may contain credentials. Provide a clear-data action.
- Render playlist metadata as text, never HTML. Accept only supported HTTP(S) media/logo URLs, reject unsafe schemes, and limit input sizes.
- Direct playback exposes stream URLs to the viewing browser. A static app cannot keep them secret from the device user.

## 4. UX specification

### My Channels

- Default launch screen; restore the last focused channel without automatically starting playback on page load.
- Large, readable rows with channel name, optional logo and clear focused/playing states.
- Separate focused, selected and currently playing state: moving focus must not start a stream.
- Empty state with Import Source and Browse Channels actions.
- An accessible Add Channels action opens the full catalogue.
- Reorder using Move Up / Move Down buttons. No drag-only functionality.
- Removing a channel affects My Channels only; it does not delete the source channel.

### All Channels

- Search by normalized channel name, filter by group/category, and visibly add/remove favourites.
- Use a bounded row window or simple pagination. Never render the entire source list.
- Preserve search, category, page and focused channel when returning from playback or menus.
- Show import warnings and unavailable entries without blocking usable channels.
- Keep current video running when browsing after playback has started.

### Player

- Full-window layout with an overlay for channel name, loading state and controls.
- Previous Channel, Next Channel, Play/Pause, Channels, Fullscreen and Back controls.
- Previous/next uses the active list's order; My Channels playback follows personal order. Define and test wrap-around at list ends.
- Hide controls after about four seconds of inactivity during successful playback. Keep them visible for errors or focused dialogs.
- OK while controls are hidden reveals controls; the next OK activates the focused control. Avoid accidental double activation from key repeat.
- Display loading immediately on channel selection. Provide bounded retry, Retry and Next Channel when a stream fails.
- Do not attempt to start several streams simultaneously or preload neighbouring channels.

### Settings

- Source URL entry, M3U file import, manual refresh and last successful refresh timestamp.
- Logo toggle, diagnostics, backup import/export and clear local data.
- Provide a usable file-input/button workflow on desktop; acknowledge if the TV browser lacks file download/upload support.
- Backup defaults to personal selections/order/settings without source credentials. Restoring requires reimporting or matching a source. Offer a clearly labelled optional full backup for complete local recovery, warning that it contains private URLs.

## 5. Remote navigation and fullscreen

| Context | Input | Behaviour |
| --- | --- | --- |
| List | Up / Down | Move focus one row, scroll/page as needed |
| List | Left / Right | Move between row actions or adjacent navigation regions |
| List | OK / Enter | Play the channel or activate the focused action |
| Player, controls hidden | OK / Enter | Reveal controls |
| Player, controls visible | Arrows | Navigate controls |
| Player, controls visible | OK / Enter | Activate focused control |
| Overlay/dialog | Back / Escape if delivered | Close topmost overlay and restore prior focus |

- Base all required actions on arrows and OK. Media/colour/channel buttons are optional enhancements only after actual device testing.
- Use semantic buttons and stable focus IDs. Preserve focus through pagination, filtering, removal and rerendering. Choose a predictable neighbour when the focused entry disappears.
- Do not hijack arrow/editing behaviour while a text input is being edited. Support normal Tab navigation on desktop.
- Include visible Back and Close controls because the browser may intercept the physical Back button.
- Handle browser fullscreen exit through `fullscreenchange`; actual TV key behaviour may differ.
- Full-window CSS mode must always work. Real browser fullscreen is an enhancement.
- Request fullscreen on the player container directly in a click/Enter event, before asynchronous network waits. Catch rejection and retain full-window mode.
- If the TV only supports native video fullscreen, document that custom overlays/controls may be unavailable there and offer full-window mode as an alternative.
- Catch rejected `video.play()` promises and show an explicit Play action. Never assume autoplay permission.

## 6. Data and refresh design

Use versioned storage and explicit migrations. Suggested entities:

```ts
type Source = {
  id: string;
  name: string;
  kind: 'url' | 'file';
  url?: string;
  lastSuccessfulRefreshAt?: string;
};

type Channel = {
  id: string; // Internal stable ID; not merely a stream-URL hash.
  sourceId: string;
  providerId?: string; // e.g. tvg-id; may be absent or duplicated.
  name: string;
  normalizedName: string;
  group?: string;
  logoUrl?: string;
  streamUrl: string;
  availability: 'available' | 'missing' | 'needs-review';
};

type PersonalPlaylist = {
  id: string;
  name: string;
  channelIds: string[]; // Unique, ordered references.
};
```

Refresh rules:

1. Fetch and parse a candidate catalogue without deleting the existing one.
2. Validate it; a failed/empty suspicious refresh must not wipe saved channels.
3. Reconcile using unique provider IDs within the same source where reliable; then unambiguous normalized name/group and other metadata. Exact URL equality can be a signal, but changed credentials must not break identity by themselves.
4. Preserve internal IDs for confident matches. Duplicated identifiers must not silently merge different channels.
5. Retain unavailable saved entries and label ambiguous matches for review. Do not substitute a different channel silently.
6. Commit catalogue and reference updates transactionally. Preserve personal order.
7. Show counts of added, updated, missing and ambiguous entries.

Validate backup schemas and size before applying changes; preview import impact and avoid destructive silent replacement. Handle blocked storage, quota errors and corrupt records with an explicit warning and usable temporary session state where possible.

## 7. Performance constraints

- Maintain one video element and at most one hls.js instance. Destroy old instances and event listeners when switching engine/channel or unmounting.
- Use cancellation and monotonically increasing playback request IDs so stale fetches and callbacks cannot override the latest selection.
- Do not key/remount the video element on every UI change.
- Keep time/progress events out of global catalogue state; avoid rerendering every row during playback.
- Parse large playlists off the main thread when possible; use batched IndexedDB writes.
- Debounce search approximately 150–250 ms; normalize searchable text once on import. Offload search if measured main-thread cost requires it.
- Bound rendered channel rows, such as a page of 30–50 items. Keep focus correct at page boundaries.
- Lazy-load only visible logos, limit their displayed dimensions, avoid retry loops, and support text-only rows.
- Prefer static CSS, system fonts and a small icon set. Avoid animation libraries, blur effects, autoplay backgrounds and large UI kits.
- Do not poll channel availability or fetch every logo/stream during import.
- Tune hls.js forward/back buffer settings with real streams. Bound back buffer and recovery attempts; do not promise an exact memory cap or universally optimal buffer setting.
- Compile to a browser target informed by the Phase 1 TV results. Transpilation cannot supply missing media APIs. Load only necessary polyfills.
- Avoid a service worker in version one to reduce stale-deployment issues; never cache live segments or credential-bearing manifests in an app cache.

Provisional targets, measured rather than guaranteed:

| Metric | Target / validation |
| --- | --- |
| Focus response | Aim for under 100 ms on target TV |
| Cached My Channels screen | Aim for within 2 seconds after app code becomes available |
| Catalogue stress fixture | At least 10,000 synthetic entries; record actual user catalogue size too |
| UI bundle | Aim for under 150 KB gzip initial JS, excluding deferred playback code; report measured output |
| Repeated switching | No accumulating players, listeners, timers or monotonic memory growth after settling |
| Channel start | Report median and slow cases over repeated trials; separate provider/network delay from UI delay |

## 8. Phased implementation checklist

### Phase 1 — Playback and TV compatibility prototype

**Tasks**

- [ ] Inspect/scaffold repository, configure TypeScript and a production build.
- [ ] Build URL input, Play, Stop, Full-window and Fullscreen controls.
- [ ] Implement native HLS detection and deferred hls.js fallback with engine cleanup.
- [ ] Add a small redacted diagnostic panel: browser/media capability checks, video state, errors and received remote keys.
- [ ] Distinguish unsupported playback, blocked fetch, HTTP/HTTPS issues and unavailable provider responses where observable; label uncertain diagnoses honestly.
- [ ] Verify desktop operation, produce Vercel deployment instructions, and obtain an actual-TV test.
- [ ] Document exact TV model, firmware, browser behaviour and tested stream formats when supplied.

**Acceptance gate:** a real channel plays with audio on the target TV; Play/Stop and arrow/OK input work; fullscreen behaviour is documented. If this fails, report the blocker and smallest viable change. Do not promise compatibility or build a media backend automatically.

**Deliverables:** runnable prototype, compatibility notes, deployment instructions and updated status file.

### Phase 2 — M3U import, storage and catalogue

**Tasks**

- [ ] Parse EXTINF fields, names containing commas, groups, logo URLs, BOM, CRLF, comments and malformed records.
- [ ] Resolve relative URLs against the source URL when available; report unsupported relative references in file imports without a base.
- [ ] Detect media manifests and unsupported provider directives.
- [ ] Add URL/file import, progress, cancellation and configurable documented input-size limits.
- [ ] Move large parsing work to a worker or yielding fallback.
- [ ] Implement versioned IndexedDB repositories, transactional imports and safe storage-error handling.
- [ ] Build paginated/bounded All Channels with search, categories and stable focus.
- [ ] Add a synthetic 10,000-channel fixture with no real credentials.

**Acceptance gate:** a large catalogue imports without sustained UI freezing; records survive reload; malformed data yields warnings; failed import preserves existing data; list rendering remains bounded.

### Phase 3 — My Channels and durable refresh

**Tasks**

- [ ] Add/remove channels with duplicate prevention and visible saved state.
- [ ] Implement ordered My Channels and remote-friendly Move Up / Move Down actions.
- [ ] Make My Channels the home screen and restore last focused channel.
- [ ] Implement source refresh reconciliation and unavailable/ambiguous saved entries.
- [ ] Add personal-only backup, optional full backup and validated restore.
- [ ] Add clear-data controls with a concrete confirmation for deletion.

**Acceptance gate:** favourites and order survive reload and source URL/token changes when entries can be confidently matched; duplicates do not corrupt references; missing entries remain visible; backup round-trip preserves intended data.

### Phase 4 — Complete viewing and remote UX

**Tasks**

- [ ] Build player overlays and previous/next controls using active-list order.
- [ ] Add deterministic focus navigation and restoration across lists, menus and playback.
- [ ] Keep playback active while browsing; show current-channel status separately from focus.
- [ ] Add fullscreen lifecycle handling, rejected autoplay handling and visible fallback controls.
- [ ] Implement immediate loading feedback, cancellation of obsolete selections and bounded retries.
- [ ] Handle removed/currently playing entries, rapid key repeats, disconnect/reconnect and browser resume.
- [ ] Check TV readability, high-contrast focus, mobile layout and desktop keyboard support.

**Acceptance gate:** importing/selecting favourites, selecting a channel, changing channels, opening/closing controls and entering/exiting supported fullscreen modes require no mouse. Rapid selections leave only the latest stream active.

### Phase 5 — Performance, reliability and Vercel release

**Tasks**

- [ ] Measure production bundles, catalogue responsiveness and channel-start timings.
- [ ] Test repeated switching and at least one hour of continuous viewing on the actual TV.
- [ ] Inspect listener/timer/player cleanup; use desktop profiling plus observable TV behaviour where TV profiling is unavailable.
- [ ] Test expired URLs, missing logos, duplicate IDs, failed refresh, storage failures, fullscreen rejection and unsupported streams.
- [ ] Run meaningful parser, reconciliation, storage and playback lifecycle tests.
- [ ] Run a keyboard E2E workflow with fake/test media; separate simulated tests from real-provider/TV evidence.
- [ ] Deploy the production build through the user's authorized Vercel workflow; otherwise deliver exact build/deployment steps and identify the remaining action.
- [ ] Use a stable production origin so preview-domain changes do not appear to erase local data.
- [ ] Document setup, local-data limitations, backups, CORS/HTTPS troubleshooting and known TV limitations.

**Acceptance gate:** production build and automated checks pass; normal operation is remote-friendly; hardware results are recorded; sensitive data is absent from committed fixtures/build configuration/logs; any remaining limitations are explicitly listed.

## 9. Suggested source layout

```text
src/
  app/                    # App shell and screen selection
  features/catalogue/     # Search, category filter, bounded list
  features/my-channels/   # Saved list, ordering, unavailable entries
  features/player/        # Video element, engine adapter, overlays
  features/settings/      # Import, backup, diagnostics
  lib/m3u/                # Pure parser and format detection
  lib/storage/            # IndexedDB repositories and migrations
  lib/reconciliation/     # Stable identity and refresh logic
  lib/navigation/         # Focus and remote-key handling
  workers/                # Large playlist parsing/search as needed
  styles/                 # Lightweight TV-first CSS
tests/
  fixtures/               # Synthetic M3U catalogues only
  unit/
  e2e/
README.md
IMPLEMENTATION_STATUS.md
```

Keep this structure proportional to implementation complexity. Avoid introducing abstractions with no current purpose.

## 10. Required handoff at completion

- Runnable source, dependency lockfile and build commands.
- Clear Vercel deployment instructions and deployment URL if actually deployed.
- Compatibility notes including model/software details when known.
- Automated test results and separate actual-TV test results.
- Measured performance figures, known limitations and unresolved blockers.
- A short user guide for importing a source, building My Channels, reordering, watching in fullscreen, refreshing and backing up.

## 11. Official references to verify during implementation

- hls.js browser support and CORS requirements: https://github.com/video-dev/hls.js
- hls.js API and buffering configuration: https://hlsjs.video-dev.org/api-docs/
- Fullscreen API and user activation: https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen
- Browser storage: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- localStorage behaviour: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
- Vercel function limits if a backend is later considered: https://vercel.com/docs/functions/limitations

## Starting instruction

Read this specification and the repository instructions. Implement Phase 1 now, run the available checks, and give me the runnable prototype plus instructions to test it in my VIDAA TV browser. Track subsequent phases in IMPLEMENTATION_STATUS.md. Do not claim that real-TV playback, fullscreen or remote navigation has passed until there is actual device evidence.
