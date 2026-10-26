import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useApp, usePlayback } from '../../app/context';
import { navKey } from '../../lib/navigation/keys';
import { focusById } from '../../lib/navigation/focus';
import { fullscreenSupported } from './fullscreen';

export const HIDE_CONTROLS_MS = 4000;

const LIST_LABEL = { my: 'My Channels', all: 'All Channels', lab: 'Stream Lab' } as const;

export function PlayerOverlay({ onLeave }: { onLeave: () => void }) {
  const app = useApp();
  const { controller, activeList } = app;
  const state = usePlayback(controller);
  const [visible, setVisible] = useState(true);
  const [poke, setPoke] = useState(0);
  const lastControl = useRef('pl:play');

  const status = state.status;
  const keepVisible = status !== 'playing';

  // Auto-hide only during healthy playback.
  useEffect(() => {
    if (keepVisible) {
      setVisible(true);
      return;
    }
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), HIDE_CONTROLS_MS);
    return () => clearTimeout(t);
  }, [keepVisible, visible, poke]);

  // Move focus to the action that matters when the state demands attention.
  useEffect(() => {
    if (status === 'error') focusById('pl:retry');
    else if (status === 'needs-gesture') focusById('pl:resume');
  }, [status, state.requestId]);

  const reveal = useCallback(() => {
    setVisible(true);
    setPoke((p) => p + 1);
  }, []);

  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = navKey(e.nativeEvent);
    if (!k || k === 'back') return;
    if (!visible) {
      // First key press only reveals the controls; it never activates one.
      e.preventDefault();
      e.stopPropagation();
      reveal();
      focusById(lastControl.current) || focusById('pl:play');
      return;
    }
    setPoke((p) => p + 1);
  };

  const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const id = (e.target as HTMLElement).dataset.focusId;
    if (id?.startsWith('pl:')) lastControl.current = id;
  };

  const channel = state.channel;
  const position = activeList && activeList.kind !== 'lab' && activeList.index >= 0 ? `${activeList.index + 1} / ${activeList.ids.length} · ${LIST_LABEL[activeList.kind]}` : activeList ? LIST_LABEL[activeList.kind] : '';
  const canStep = !!activeList && activeList.kind !== 'lab' && activeList.ids.length > 1;
  const isPaused = status === 'paused';

  return (
    <div
      className={`overlay${visible ? '' : ' overlay-hidden'}`}
      onKeyDownCapture={onKeyDownCapture}
      onMouseMove={reveal}
      onClick={visible ? undefined : reveal}
      onFocus={onFocus}
    >
      <div className="overlay-top">
        <div className="overlay-title">{channel?.name ?? 'Nothing playing'}</div>
        <div className="overlay-sub">
          {position}
          {state.engine && <span className="muted"> · {state.engine}</span>}
        </div>
        {state.notes.map((n) => (
          <div key={n} className="overlay-note">
            {n}
          </div>
        ))}
      </div>

      {(status === 'loading' || status === 'buffering') && (
        <div className="overlay-center" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>{state.message ?? (status === 'buffering' ? 'Buffering…' : 'Loading channel…')}</span>
        </div>
      )}

      {status === 'needs-gesture' && (
        <div className="overlay-center">
          <p>{state.message}</p>
          <button type="button" className="btn btn-primary btn-large" data-focus-id="pl:resume" onClick={() => controller?.resume()}>
            ▶ Play
          </button>
        </div>
      )}

      {status === 'error' && state.error && (
        <div className="overlay-center overlay-error" role="alert">
          <p className="error-title">{state.error.title}</p>
          <p>{state.error.detail}</p>
          {!state.error.certain && <p className="muted">This diagnosis is a best guess: the browser does not expose the exact cause.</p>}
          {state.error.technical && <p className="muted small">{state.error.technical}</p>}
          <div className="error-actions">
            <button type="button" className="btn btn-primary" data-focus-id="pl:retry" onClick={() => controller?.retry()}>
              Retry
            </button>
            {canStep && (
              <button type="button" className="btn" data-focus-id="pl:skip" onClick={() => app.step(1)}>
                Next channel
              </button>
            )}
          </div>
        </div>
      )}

      <div className="overlay-bottom" role="toolbar" aria-label="Player controls">
        <button type="button" className="btn" data-focus-id="pl:prev" disabled={!canStep} onClick={() => app.step(-1)}>
          ⏮ Prev
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-focus-id="pl:play"
          data-autofocus
          disabled={status === 'error' || status === 'idle'}
          onClick={() => controller?.togglePause()}
        >
          {isPaused || status === 'needs-gesture' ? '▶ Play' : '⏸ Pause'}
        </button>
        <button type="button" className="btn" data-focus-id="pl:next" disabled={!canStep} onClick={() => app.step(1)}>
          Next ⏭
        </button>
        <button type="button" className="btn" data-focus-id="pl:channels" onClick={onLeave}>
          ☰ Channels
        </button>
        <button type="button" className="btn" data-focus-id="pl:fs" onClick={app.toggleFullscreen} disabled={!fullscreenSupported()} title={fullscreenSupported() ? undefined : 'Fullscreen API unavailable; full-window mode is active'}>
          {app.isFullscreen ? '⤡ Exit fullscreen' : '⤢ Fullscreen'}
        </button>
        <button
          type="button"
          className="btn"
          data-focus-id="pl:stop"
          onClick={() => {
            controller?.stop();
            onLeave();
          }}
        >
          ■ Stop
        </button>
        <button type="button" className="btn" data-focus-id="pl:back" onClick={onLeave}>
          ← Back
        </button>
      </div>
    </div>
  );
}
