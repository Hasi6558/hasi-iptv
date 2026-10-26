import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useApp, usePlayback } from '../../app/context';
import { getKeyLog, subscribeKeyLog } from '../../lib/navigation/keys';
import { redactUrl, safeHttpUrl } from '../../lib/m3u/url';
import { canPlayNativeHls } from '../player/controller';
import { fullscreenElement, fullscreenSupported, requestFullscreen } from '../player/fullscreen';

type Capability = { name: string; value: string };

function mseSupports(type: string): string {
  const MS = (window as unknown as { MediaSource?: typeof MediaSource; ManagedMediaSource?: typeof MediaSource }).MediaSource
    ?? (window as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource;
  if (!MS || typeof MS.isTypeSupported !== 'function') return 'no MSE';
  try {
    return MS.isTypeSupported(type) ? 'yes' : 'no';
  } catch {
    return 'error';
  }
}

function canPlay(video: HTMLVideoElement, type: string): string {
  try {
    return video.canPlayType(type) || 'no';
  } catch {
    return 'error';
  }
}

export function collectCapabilities(): Capability[] {
  const v = document.createElement('video');
  const w = window as unknown as Record<string, unknown>;
  const yes = (b: unknown) => (b ? 'yes' : 'no');
  return [
    { name: 'User agent', value: navigator.userAgent },
    { name: 'Viewport (CSS px)', value: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio || 1}x` },
    { name: 'Screen', value: `${screen.width}×${screen.height}` },
    { name: 'Page protocol', value: location.protocol },
    { name: 'Online', value: String(navigator.onLine) },
    { name: 'Native HLS (canPlayType)', value: canPlayNativeHls(v) ? `${canPlay(v, 'application/vnd.apple.mpegurl')} / ${canPlay(v, 'application/x-mpegurl')}` : 'no' },
    { name: 'MediaSource', value: yes(w.MediaSource) },
    { name: 'ManagedMediaSource', value: yes(w.ManagedMediaSource) },
    { name: 'MSE H.264 + AAC', value: mseSupports('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') },
    { name: 'MSE H.264 High', value: mseSupports('video/mp4; codecs="avc1.640028"') },
    { name: 'MSE HEVC', value: mseSupports('video/mp4; codecs="hvc1.1.6.L93.B0"') },
    { name: 'MSE AC-3', value: mseSupports('audio/mp4; codecs="ac-3"') },
    { name: 'Native MP4 H.264', value: canPlay(v, 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"') },
    { name: 'Native MPEG-TS', value: canPlay(v, 'video/mp2t') },
    { name: 'Native WebM VP9', value: canPlay(v, 'video/webm; codecs="vp9"') },
    { name: 'Fullscreen API', value: yes(fullscreenSupported()) },
    { name: 'IndexedDB', value: yes(w.indexedDB) },
    { name: 'localStorage', value: (() => { try { return yes(window.localStorage); } catch { return 'blocked'; } })() },
    { name: 'Web Worker', value: yes(w.Worker) },
    { name: 'fetch / AbortController', value: `${yes(w.fetch)} / ${yes(w.AbortController)}` },
    { name: 'ReadableStream', value: yes(w.ReadableStream) },
    { name: 'ES modules', value: yes('noModule' in document.createElement('script')) },
  ];
}

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Phase 1 compatibility prototype: test a single stream URL and inspect what the TV browser supports. */
export function StreamLab() {
  const app = useApp();
  const { controller } = app;
  const state = usePlayback(controller);
  const [url, setUrl] = useState('');
  const [hlsInfo, setHlsInfo] = useState('not loaded');
  const [tick, setTick] = useState(0);
  const [report, setReport] = useState<string | null>(null);
  const capabilities = useMemo(collectCapabilities, []);
  const keys = useSyncExternalStore(subscribeKeyLog, getKeyLog);

  // Poll the video element only while this screen is open; nothing else re-renders on time updates.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const video = controller?.video;
  const bufferedAhead = (() => {
    if (!video || !video.buffered.length) return 0;
    return Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime);
  })();
  const timings = controller?.startTimings ?? [];
  const valid = safeHttpUrl(url);

  const videoFacts: Capability[] = [
    { name: 'Status', value: state.status + (state.message ? ` — ${state.message}` : '') },
    { name: 'Channel', value: state.channel ? `${state.channel.name} (${redactUrl(state.channel.streamUrl)})` : '—' },
    { name: 'Engine', value: state.engine ?? '—' },
    { name: 'hls.js instances', value: String(controller?.activeHlsInstances ?? 0) },
    { name: 'readyState / networkState', value: video ? `${video.readyState} / ${video.networkState}` : '—' },
    { name: 'paused / currentTime', value: video ? `${video.paused} / ${video.currentTime.toFixed(1)}s` : '—' },
    { name: 'Buffered ahead', value: `${bufferedAhead.toFixed(1)}s` },
    { name: 'Resolution', value: video && video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : '—' },
    { name: 'Error', value: state.error ? `${state.error.title} [${state.error.diagnosis}${state.error.certain ? '' : ', uncertain'}] ${state.error.technical ?? ''}` : '—' },
    { name: 'Channel start (median / slowest / n)', value: timings.length ? `${median(timings)} ms / ${Math.max(...timings)} ms / ${timings.length}` : '—' },
    { name: 'Fullscreen element', value: fullscreenElement() ? 'yes' : 'no' },
  ];
  void tick;

  const checkHls = async () => {
    setHlsInfo('loading…');
    try {
      const Hls = (await import('hls.js')).default;
      setHlsInfo(`v${Hls.version}: ${Hls.isSupported() ? 'supported' : 'NOT supported (no usable MediaSource)'}`);
    } catch {
      setHlsInfo('failed to load module');
    }
  };

  const buildReport = () => {
    const lines = [
      `Hasi IPTV ${__APP_VERSION__} diagnostics (${new Date().toISOString()})`,
      '',
      '[Capabilities]',
      ...capabilities.map((c) => `${c.name}: ${c.value}`),
      `hls.js: ${hlsInfo}`,
      '',
      '[Playback]',
      ...videoFacts.map((c) => `${c.name}: ${c.value}`),
      '',
      '[Received keys, newest first]',
      ...keys.map((k) => `key=${k.key} code=${k.code} keyCode=${k.keyCode}`),
    ];
    setReport(lines.join('\n'));
  };

  return (
    <section className="screen lab" aria-labelledby="lab-title">
      <header className="screen-header">
        <h1 id="lab-title">Stream Lab & diagnostics</h1>
        <div className="header-actions">
          <button type="button" className="btn" data-focus-id="lab:back" onClick={() => app.go('settings')}>
            ← Settings
          </button>
        </div>
      </header>

      <div className="panel">
        <h2>Test a stream</h2>
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) app.playLab(valid, false);
          }}
        >
          <label className="field">
            <span>Stream URL (HLS .m3u8 or direct video)</span>
            <input type="url" data-focus-id="lab:url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/stream.m3u8" autoComplete="off" spellCheck={false} maxLength={4096} />
          </label>
        </form>
        <div className="button-row">
          <button type="button" className="btn btn-primary" data-focus-id="lab:play" disabled={!valid} onClick={() => valid && app.playLab(valid, false)}>
            ▶ Play
          </button>
          <button type="button" className="btn" data-focus-id="lab:stop" disabled={state.status === 'idle'} onClick={() => controller?.stop()}>
            ■ Stop
          </button>
          <button type="button" className="btn" data-focus-id="lab:window" disabled={!valid && state.status === 'idle'} onClick={() => (state.status === 'idle' && valid ? app.playLab(valid, true) : app.go('player'))}>
            Full-window
          </button>
          <button
            type="button"
            className="btn"
            data-focus-id="lab:fullscreen"
            disabled={!valid && state.status === 'idle'}
            onClick={() => {
              const root = app.appRoot();
              // Request first, synchronously in the handler, then start loading.
              if (root) {
                void requestFullscreen(root).then((ok) => {
                  if (!ok) app.notify({ kind: 'info', text: 'Fullscreen was refused; using full-window mode.' });
                });
              }
              if (state.status === 'idle' && valid) app.playLab(valid, true);
              else app.go('player');
            }}
          >
            Fullscreen
          </button>
          <button type="button" className="btn" data-focus-id="lab:hls" onClick={() => void checkHls()}>
            Check hls.js
          </button>
          <button type="button" className="btn" data-focus-id="lab:report" onClick={buildReport}>
            Show text report
          </button>
        </div>
        <p className="hint">Playing here uses the same single video element and engine as the channel player. Stream addresses are shortened to the host name in this panel.</p>
      </div>

      <div className="lab-grid">
        <div className="panel">
          <h2>Playback</h2>
          <FactTable rows={videoFacts} />
        </div>
        <div className="panel">
          <h2>Received keys</h2>
          <p className="hint">Press remote buttons to see what the browser receives. Arrows, OK and Back are what the app relies on.</p>
          {keys.length === 0 ? (
            <p className="muted">No keys yet.</p>
          ) : (
            <table className="facts-table">
              <thead>
                <tr>
                  <th>key</th>
                  <th>code</th>
                  <th>keyCode</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.at + k.key}>
                    <td>{k.key}</td>
                    <td>{k.code}</td>
                    <td>{k.keyCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Browser capabilities</h2>
        <FactTable rows={[...capabilities, { name: 'hls.js', value: hlsInfo }]} />
      </div>

      {report && (
        <div className="panel">
          <h2>Text report</h2>
          <textarea className="report" readOnly value={report} rows={14} data-focus-id="lab:report-text" />
        </div>
      )}
    </section>
  );
}

function FactTable({ rows }: { rows: Capability[] }) {
  return (
    <table className="facts-table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <th scope="row">{r.name}</th>
            <td>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
