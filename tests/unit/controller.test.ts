import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { engineOrder, MAX_RETRIES, PlaybackController, START_TIMEOUT_MS, type ControllerDeps } from '../../src/features/player/controller';
import { fromHlsError, fromMediaError } from '../../src/features/player/diagnosis';

/** Minimal stand-in for HTMLVideoElement: just what the controller touches. */
class FakeVideo extends EventTarget {
  attrs = new Map<string, string>();
  paused = true;
  error: { code: number; message: string } | null = null;
  nativeHls = false;
  playBehaviour: 'resolve' | 'not-allowed' = 'resolve';
  loads = 0;
  get src() {
    return this.attrs.get('src') ?? '';
  }
  set src(v: string) {
    this.attrs.set('src', v);
  }
  hasAttribute(n: string) {
    return this.attrs.has(n);
  }
  getAttribute(n: string) {
    return this.attrs.get(n) ?? null;
  }
  removeAttribute(n: string) {
    this.attrs.delete(n);
  }
  load() {
    this.loads++;
  }
  pause() {
    this.paused = true;
  }
  play() {
    if (this.playBehaviour === 'not-allowed') return Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    this.paused = false;
    return Promise.resolve();
  }
  canPlayType(t: string) {
    return this.nativeHls && t.includes('mpegurl') ? 'maybe' : '';
  }
  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

type Handler = (evt: string, data: unknown) => void;

class FakeHls {
  static instances: FakeHls[] = [];
  static supported = true;
  static isSupported() {
    return FakeHls.supported;
  }
  static Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
  static ErrorTypes = { MEDIA_ERROR: 'mediaError', NETWORK_ERROR: 'networkError' };
  handlers = new Map<string, Handler>();
  destroyed = false;
  recovered = 0;
  url = '';
  constructor() {
    FakeHls.instances.push(this);
  }
  on(evt: string, fn: Handler) {
    this.handlers.set(evt, fn);
  }
  loadSource(u: string) {
    this.url = u;
  }
  attachMedia() {}
  destroy() {
    this.destroyed = true;
  }
  recoverMediaError() {
    this.recovered++;
  }
  emit(evt: string, data: unknown = {}) {
    this.handlers.get(evt)?.(evt, data);
  }
}

const live = () => FakeHls.instances.filter((h) => !h.destroyed);

function setup(opts: { nativeHls?: boolean; online?: boolean } = {}) {
  const video = new FakeVideo();
  video.nativeHls = !!opts.nativeHls;
  let online = opts.online ?? true;
  const deps: ControllerDeps = {
    loadHls: async () => FakeHls as never,
    isOnline: () => online,
    pageProtocol: () => 'https:',
  };
  const c = new PlaybackController(video as unknown as HTMLVideoElement, deps);
  return { video, c, setOnline: (v: boolean) => (online = v) };
}

const ch = (id: string, url = `https://s.example/${id}.m3u8`) => ({ id, name: id.toUpperCase(), streamUrl: url });

beforeEach(() => {
  FakeHls.instances = [];
  FakeHls.supported = true;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('engineOrder', () => {
  it('prefers native HLS when reported, with hls.js as fallback', () => {
    expect(engineOrder('https://x/a.m3u8', 'auto', true)).toEqual(['native', 'hls.js']);
    expect(engineOrder('https://x/a.m3u8', 'auto', false)).toEqual(['hls.js', 'native']);
    expect(engineOrder('https://x/live', 'auto', false)).toEqual(['hls.js', 'native']); // extensionless
    expect(engineOrder('https://x/a.mp4', 'auto', false)).toEqual(['native']);
    expect(engineOrder('https://x/a.m3u8', 'hls.js', true)).toEqual(['hls.js']);
  });
});

describe('PlaybackController lifecycle', () => {
  it('rapid switching leaves exactly one hls.js instance, for the latest channel', async () => {
    const { c } = setup();
    for (let i = 0; i < 20; i++) c.play(ch(`c${i}`));
    await vi.runAllTicks();
    await Promise.resolve();
    await Promise.resolve();
    expect(live()).toHaveLength(1);
    expect(live()[0].url).toContain('c19');
    expect(c.getState().channel?.id).toBe('c19');
    expect(c.activeHlsInstances).toBe(1);
  });

  it('delayed zapping only loads the final selection', async () => {
    const { c } = setup();
    c.play(ch('a'), 350);
    c.play(ch('b'), 350);
    c.play(ch('c'), 350);
    expect(c.getState()).toMatchObject({ status: 'loading', channel: { id: 'c' } }); // immediate feedback
    await vi.advanceTimersByTimeAsync(400);
    expect(FakeHls.instances).toHaveLength(1);
    expect(FakeHls.instances[0].url).toContain('/c.m3u8');
  });

  it('ignores errors from a stale instance', async () => {
    const { c } = setup();
    c.play(ch('a'));
    await vi.advanceTimersByTimeAsync(0);
    const old = FakeHls.instances[0];
    c.play(ch('b'));
    await vi.advanceTimersByTimeAsync(0);
    old.emit('hlsError', { fatal: true, type: 'networkError', details: 'manifestLoadError', response: { code: 404 } });
    expect(c.getState().status).toBe('loading');
    expect(c.getState().channel?.id).toBe('b');
  });

  it('reaches playing and clears the start timeout', async () => {
    const { c, video } = setup();
    c.play(ch('a'));
    await vi.advanceTimersByTimeAsync(0);
    FakeHls.instances[0].emit('hlsManifestParsed');
    video.fire('playing');
    expect(c.getState().status).toBe('playing');
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS * 2);
    expect(c.getState().status).toBe('playing');
    expect(c.startTimings).toHaveLength(1);
  });

  it('retries a bounded number of times, then shows an error', async () => {
    const { c } = setup({ nativeHls: false });
    c.enginePreference = 'hls.js';
    c.play(ch('a'));
    for (let i = 0; i <= MAX_RETRIES; i++) {
      await vi.advanceTimersByTimeAsync(10_000);
      live()[0]?.emit('hlsError', { fatal: true, type: 'networkError', details: 'manifestLoadError', response: { code: 0 } });
    }
    await vi.advanceTimersByTimeAsync(10_000);
    expect(c.getState().status).toBe('error');
    expect(c.getState().error?.diagnosis).toBe('network');
    expect(FakeHls.instances).toHaveLength(MAX_RETRIES + 1);
    expect(live()).toHaveLength(0);
  });

  it('does not retry definitive provider errors', async () => {
    const { c } = setup();
    c.enginePreference = 'hls.js';
    c.play(ch('a'));
    await vi.advanceTimersByTimeAsync(0);
    FakeHls.instances[0].emit('hlsError', { fatal: true, type: 'networkError', details: 'manifestLoadError', response: { code: 404 } });
    expect(c.getState()).toMatchObject({ status: 'error', error: { diagnosis: 'provider-http', httpStatus: 404 } });
  });

  it('recovers a media error once before failing over', async () => {
    const { c } = setup();
    c.enginePreference = 'hls.js';
    c.play(ch('a'));
    await vi.advanceTimersByTimeAsync(0);
    const h = FakeHls.instances[0];
    h.emit('hlsError', { fatal: true, type: 'mediaError', details: 'bufferStalledError' });
    expect(h.recovered).toBe(1);
    expect(c.getState().status).toBe('loading');
    h.emit('hlsError', { fatal: true, type: 'mediaError', details: 'bufferAddCodecError' });
    expect(c.getState()).toMatchObject({ status: 'error', error: { diagnosis: 'unsupported' } });
  });

  it('falls back from native to hls.js when native playback fails', async () => {
    const { c, video } = setup({ nativeHls: true });
    c.play(ch('a'));
    expect(c.getState().engine).toBe('native');
    video.error = { code: 4, message: '' };
    video.fire('error');
    await vi.advanceTimersByTimeAsync(0);
    expect(c.getState().engine).toBe('hls.js');
    expect(video.getAttribute('src')).toBeNull();
    expect(FakeHls.instances).toHaveLength(1);
  });

  it('shows an explicit Play action when autoplay is refused', async () => {
    const { c, video } = setup({ nativeHls: true });
    video.playBehaviour = 'not-allowed';
    c.play(ch('a', 'https://s.example/a.mp4'));
    await vi.advanceTimersByTimeAsync(0);
    expect(c.getState().status).toBe('needs-gesture');
    video.playBehaviour = 'resolve';
    c.resume();
    video.fire('playing');
    expect(c.getState().status).toBe('playing');
  });

  it('labels http streams on https pages as likely mixed-content blocks', async () => {
    const { c } = setup();
    c.enginePreference = 'hls.js';
    c.play(ch('a', 'http://insecure.example/a.m3u8'));
    expect(c.getState().notes[0]).toMatch(/http:\/\//);
    await vi.advanceTimersByTimeAsync(0);
    FakeHls.instances[0].emit('hlsError', { fatal: true, type: 'networkError', details: 'manifestLoadError', response: { code: 0 } });
    expect(c.getState()).toMatchObject({ status: 'error', error: { diagnosis: 'mixed-content', certain: false } });
  });

  it('a native demuxer error on an http stream tries hls.js and is not blamed on mixed content', async () => {
    const { c, video } = setup({ nativeHls: true });
    c.play(ch('a', 'http://insecure.example/a.m3u8'));
    expect(c.getState().engine).toBe('native');
    video.error = { code: 4, message: 'PipelineStatus::DEMUXER_ERROR_COULD_NOT_PARSE' };
    video.fire('error');
    await vi.advanceTimersByTimeAsync(0);
    expect(c.getState().engine).toBe('hls.js'); // fallback was attempted
    // hls.js fetch of http:// from https:// is blocked: a status-0 network error.
    FakeHls.instances[0].emit('hlsError', { fatal: true, type: 'networkError', details: 'manifestLoadError', response: { code: 0 } });
    const err = c.getState().error!;
    expect(c.getState().status).toBe('error');
    expect(err.diagnosis).toBe('unsupported');
    expect(err.title).toBe('Stream format not supported by this player');
    expect(err.detail).toMatch(/hls\.js player could not try it/);
  });

  it('stop releases the engine and the decoder', async () => {
    const { c, video } = setup();
    c.play(ch('a'));
    await vi.advanceTimersByTimeAsync(0);
    c.stop();
    expect(live()).toHaveLength(0);
    expect(c.getState().status).toBe('idle');
    expect(video.getAttribute('src')).toBeNull();
  });

  it('destroy removes all listeners', async () => {
    const { c, video } = setup();
    const spy = vi.fn();
    c.subscribe(spy);
    c.destroy();
    spy.mockClear();
    video.fire('playing');
    video.fire('waiting');
    expect(spy).not.toHaveBeenCalled();
  });

  it('a stall during playback times out into a retry', async () => {
    const { c, video } = setup();
    c.enginePreference = 'hls.js';
    c.play(ch('a'));
    await vi.advanceTimersByTimeAsync(0);
    video.fire('playing');
    video.fire('waiting');
    expect(c.getState().status).toBe('buffering');
    await vi.advanceTimersByTimeAsync(21_000);
    expect(c.getState().status).toBe('loading');
    expect(c.getState().attempt).toBe(1);
  });

  it('missing channels without a URL fail immediately with a clear message', () => {
    const { c } = setup();
    c.play({ id: 'm', name: 'Missing', streamUrl: '' });
    expect(c.getState()).toMatchObject({ status: 'error', error: { title: 'Channel unavailable' } });
  });
});

describe('diagnosis mapping', () => {
  it('maps offline state regardless of error type', () => {
    expect(fromHlsError({ type: 'networkError' }, false).diagnosis).toBe('offline');
    expect(fromMediaError({ code: 2 } as MediaError, false).diagnosis).toBe('offline');
  });
  it('treats Chromium demuxer errors as a certain format problem with data received', () => {
    const e = fromMediaError({ code: 4, message: 'PipelineStatus::DEMUXER_ERROR_COULD_NOT_PARSE' } as MediaError, true);
    expect(e).toMatchObject({ diagnosis: 'unsupported', certain: true, dataReceived: true, retryable: false });
  });
  it('marks native "not supported" as uncertain', () => {
    expect(fromMediaError({ code: 4 } as MediaError, true)).toMatchObject({ diagnosis: 'unsupported', certain: false });
  });
});
