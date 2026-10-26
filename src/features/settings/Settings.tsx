import { useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Dialog } from '../../app/Dialog';
import { redactUrl, safeHttpUrl } from '../../lib/m3u/url';
import { LIMITS } from '../../lib/m3u/parser';
import { CancelledError } from '../../lib/m3u/parseAsync';
import { ImportError } from '../../lib/m3u/fetchText';
import type { EnginePreference } from '../../lib/storage/prefs';
import { runImport, type ImportInput, type ImportProgress } from './importer';
import { BackupSection } from './BackupSection';
import { ClearDataSection } from './ClearDataSection';

export const PUBLIC_SAMPLE_URL = 'https://iptv-org.github.io/iptv/index.m3u';

const ENGINES: EnginePreference[] = ['auto', 'native', 'hls.js'];

function progressText(p: ImportProgress): string {
  if (p.phase === 'download') {
    const mb = (p.bytes / 1024 / 1024).toFixed(1);
    return p.total ? `Downloading… ${mb} of ${(p.total / 1024 / 1024).toFixed(1)} MB` : `Downloading… ${mb} MB`;
  }
  if (p.phase === 'parse') return `Reading channels… ${Math.round(p.fraction * 100)}%`;
  return 'Saving…';
}

function formatDate(iso?: string): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? 'unknown' : d.toLocaleString();
}

export function Settings() {
  const app = useApp();
  const { source, prefs, setPrefs } = app;
  const [url, setUrl] = useState('');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; resolve: (ok: boolean) => void } | null>(null);
  const [showWarnings, setShowWarnings] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = progress !== null;

  const start = async (input: ImportInput) => {
    if (busy) return;
    setError(null);
    app.setLastImport(undefined);
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortRef.current = ctrl;
    setProgress({ phase: 'download', bytes: 0 });
    try {
      const outcome = await runImport({
        input,
        source,
        channels: app.channels,
        playlist: app.playlist,
        repo: app.repo,
        signal: ctrl?.signal,
        onProgress: setProgress,
        confirmSuspicious: (message) => new Promise((resolve) => setConfirm({ message, resolve })),
      });
      app.applyImport(outcome);
      setUrl('');
    } catch (err) {
      if (err instanceof CancelledError) setError({ message: 'Import cancelled. Your existing channels were kept.' });
      else if (err instanceof ImportError) setError({ message: err.message, hint: err.hint });
      else setError({ message: 'Import failed unexpectedly. Your existing channels were kept.', hint: err instanceof Error ? err.message : undefined });
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  const importUrl = (raw: string) => {
    const valid = safeHttpUrl(raw);
    if (!valid) {
      setError({ message: 'Enter a full http:// or https:// playlist URL.' });
      return;
    }
    void start({ kind: 'url', url: valid });
  };

  const result = app.lastImport;
  const warningEntries = result ? Object.entries(result.warningCounts).filter(([, n]) => n) : [];

  return (
    <section className="screen settings" aria-labelledby="settings-title">
      <header className="screen-header">
        <h1 id="settings-title">Settings</h1>
      </header>

      <div className="panel">
        <h2>Channel source</h2>
        {source ? (
          <dl className="facts">
            <dt>Source</dt>
            <dd>
              {source.name} ({source.kind === 'url' ? 'URL' : 'file'})
            </dd>
            {source.url && (
              <>
                <dt>Address</dt>
                <dd>{redactUrl(source.url)}</dd>
              </>
            )}
            <dt>Channels</dt>
            <dd>{app.channels.filter((c) => c.availability === 'available').length.toLocaleString()}</dd>
            <dt>Last refresh</dt>
            <dd>{formatDate(source.lastSuccessfulRefreshAt)}</dd>
          </dl>
        ) : (
          <p>No source yet. Paste your M3U playlist URL, or import a file.</p>
        )}

        {source?.kind === 'url' && source.url && (
          <button type="button" className="btn btn-primary" data-focus-id="set:refresh" data-autofocus disabled={busy} onClick={() => void start({ kind: 'url', url: source.url! })}>
            ⟳ Refresh source now
          </button>
        )}

        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            importUrl(url);
          }}
        >
          <label className="field">
            <span>{source ? 'New or updated playlist URL' : 'Playlist URL'}</span>
            <input
              type="url"
              inputMode="url"
              data-focus-id="set:url"
              placeholder="https://example.com/playlist.m3u"
              value={url}
              autoComplete="off"
              spellCheck={false}
              maxLength={4096}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary" data-focus-id="set:import-url" disabled={busy || !url.trim()}>
            Import URL
          </button>
        </form>
        <div className="button-row">
          <button type="button" className="btn" data-focus-id="set:sample" data-autofocus={!source || undefined} disabled={busy} onClick={() => importUrl(PUBLIC_SAMPLE_URL)}>
            Use public iptv-org playlist
          </button>
          <button type="button" className="btn" data-focus-id="set:file" disabled={busy} onClick={() => fileRef.current?.click()}>
            Import file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".m3u,.m3u8,audio/x-mpegurl,audio/mpegurl,application/vnd.apple.mpegurl,text/plain"
            hidden
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void start({ kind: 'file', file: f });
            }}
          />
        </div>
        <p className="hint">
          Changing the URL (for example a new token) keeps My Channels: saved channels are matched by ID and name. Files up to {LIMITS.maxPlaylistBytes / 1024 / 1024} MB and{' '}
          {LIMITS.maxEntries.toLocaleString()} channels. File import may not be available in TV browsers; it does not fix stream CORS or codec problems.
        </p>

        {progress && (
          <div className="progress" role="status">
            <span>{progressText(progress)}</span>
            {progress.phase !== 'save' && abortRef.current && (
              <button type="button" className="btn btn-small" data-focus-id="set:cancel" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
        )}
        {error && (
          <div className="notice notice-error" role="alert">
            <span>
              {error.message}
              {error.hint && <span className="block muted">{error.hint}</span>}
            </span>
          </div>
        )}
        {result && (
          <div className="notice notice-info" role="status">
            <span>
              Imported {result.total.toLocaleString()} channels: {result.stats.added} new, {result.stats.updated} updated, {result.stats.unchanged} unchanged, {result.stats.removed} removed.
              {result.stats.restored > 0 && ` ${result.stats.restored} saved channels found again.`}
              {(result.stats.missing > 0 || result.stats.ambiguous > 0) &&
                ` Saved channels: ${result.stats.missing} missing, ${result.stats.ambiguous} need review (kept in My Channels).`}
            </span>
            {warningEntries.length > 0 && (
              <button type="button" className="btn btn-small" data-focus-id="set:warnings" onClick={() => setShowWarnings(true)}>
                {warningEntries.reduce((a, [, n]) => a + (n ?? 0), 0).toLocaleString()} warnings
              </button>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Display & playback</h2>
        <div className="button-row">
          <button type="button" className="btn" data-focus-id="set:logos" aria-pressed={prefs.showLogos} onClick={() => setPrefs({ showLogos: !prefs.showLogos })}>
            Channel logos: {prefs.showLogos ? 'On' : 'Off'}
          </button>
          <button type="button" className="btn" data-focus-id="set:autofs" aria-pressed={prefs.autoFullscreen} onClick={() => setPrefs({ autoFullscreen: !prefs.autoFullscreen })}>
            Fullscreen when a channel starts: {prefs.autoFullscreen ? 'On' : 'Off'}
          </button>
          <button
            type="button"
            className="btn"
            data-focus-id="set:engine"
            onClick={() => setPrefs({ engine: ENGINES[(ENGINES.indexOf(prefs.engine) + 1) % ENGINES.length] })}
          >
            Player engine: {prefs.engine === 'auto' ? 'Automatic' : prefs.engine}
          </button>
        </div>
        <p className="hint">Automatic uses the TV's built-in HLS player when it reports support, otherwise hls.js, and tries the other if the first fails.</p>
        <button type="button" className="btn" data-focus-id="set:lab" onClick={() => app.go('lab')}>
          Stream Lab & diagnostics
        </button>
      </div>

      <BackupSection />
      <ClearDataSection />

      <div className="panel">
        <h2>About</h2>
        <p className="hint">
          Hasi IPTV {__APP_VERSION__}. Everything is stored only in this browser. Video streams go directly from the provider to this device; nothing is relayed or recorded.
        </p>
      </div>

      {confirm && (
        <Dialog
          title="Refresh looks incomplete"
          onClose={() => {
            confirm.resolve(false);
            setConfirm(null);
          }}
          actions={
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                confirm.resolve(true);
                setConfirm(null);
              }}
            >
              Use it anyway
            </button>
          }
        >
          <p>{confirm.message}</p>
          <p>Saved channels that are not found will stay in My Channels marked as missing.</p>
        </Dialog>
      )}

      {showWarnings && result && (
        <Dialog title="Import warnings" onClose={() => setShowWarnings(false)} wide>
          <ul className="plain-list">
            {warningEntries.map(([code, n]) => (
              <li key={code}>
                <strong>{code}</strong>: {n}
              </li>
            ))}
          </ul>
          <ul className="plain-list small">
            {result.warnings.slice(0, 50).map((w, i) => (
              <li key={i}>
                Line {w.line}: {w.message}
              </li>
            ))}
          </ul>
          {result.warnings.length > 50 && <p className="hint">Showing the first 50 warnings.</p>}
        </Dialog>
      )}
    </section>
  );
}
