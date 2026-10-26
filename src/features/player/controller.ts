import type Hls from 'hls.js';
import type { ErrorData, HlsConfig } from 'hls.js';
import type { EnginePreference } from '../../lib/storage/prefs';
import { fileExtension } from '../../lib/m3u/url';
import {
  fromHlsError,
  fromMediaError,
  isMixedContent,
  mixedContentError,
  offlineError,
  timeoutError,
  type PlaybackError,
} from './diagnosis';

export type PlayableChannel = { id: string; name: string; streamUrl: string; directives?: string[] };
export type EngineName = 'native' | 'hls.js';
export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'needs-gesture' | 'error';

export type PlaybackState = {
  status: PlaybackStatus;
  channel?: PlayableChannel;
  engine?: EngineName;
  error?: PlaybackError;
  /** Automatic retry number in progress (0 = first try). */
  attempt: number;
  message?: string;
  /** Known limitations for the current channel, shown to the user. */
  notes: string[];
  requestId: number;
};

type HlsCtor = typeof Hls;

export type ControllerDeps = {
  loadHls: () => Promise<HlsCtor>;
  isOnline: () => boolean;
  pageProtocol: () => string;
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
};

export const MAX_RETRIES = 2;
export const START_TIMEOUT_MS = 20_000;
export const FALLBACK_START_TIMEOUT_MS = 12_000;
export const STALL_TIMEOUT_MS = 20_000;
const PROGRESSIVE = new Set(['mp4', 'm4v', 'webm', 'ogg', 'ogv', 'mp3', 'aac', 'm4a', 'mov']);

/** Buffer settings are deliberately modest for TV memory; tune with real streams. */
export const HLS_CONFIG: Partial<HlsConfig> = {
  enableWorker: true,
  lowLatencyMode: false,
  backBufferLength: 30,
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  maxBufferSize: 40 * 1000 * 1000,
  capLevelToPlayerSize: true,
  startFragPrefetch: false,
};

export function canPlayNativeHls(video: Pick<HTMLVideoElement, 'canPlayType'>): boolean {
  return !!(video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegurl'));
}

/** Engine attempt order for a URL. The extension is only a hint; extensionless HLS is common. */
export function engineOrder(url: string, pref: EnginePreference, nativeHls: boolean): EngineName[] {
  if (pref === 'native') return ['native'];
  if (pref === 'hls.js') return ['hls.js'];
  if (PROGRESSIVE.has(fileExtension(url))) return ['native'];
  return nativeHls ? ['native', 'hls.js'] : ['hls.js', 'native'];
}

const IDLE: PlaybackState = { status: 'idle', attempt: 0, notes: [], requestId: 0 };

/**
 * Owns the single <video> element and at most one hls.js instance.
 * Every asynchronous step checks the request ID so stale callbacks from an
 * earlier channel can never override the latest selection.
 */
export class PlaybackController {
  private state: PlaybackState = IDLE;
  private readonly listeners = new Set<(s: PlaybackState) => void>();
  private reqId = 0;
  private hls: Hls | null = null;
  private engines: EngineName[] = [];
  private engineIdx = 0;
  private mediaRecovered = false;
  private userPaused = false;
  private startTimer: ReturnType<typeof setTimeout> | undefined;
  private stallTimer: ReturnType<typeof setTimeout> | undefined;
  private delayTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private startedAt = 0;
  private hadPlayback = false;
  /** Recent channel start times in ms (time from load to first frame). */
  readonly startTimings: number[] = [];
  enginePreference: EnginePreference = 'auto';
  private readonly cleanup: (() => void)[] = [];

  constructor(
    readonly video: HTMLVideoElement,
    private readonly deps: ControllerDeps,
  ) {
    const on = <K extends keyof HTMLMediaElementEventMap>(type: K, fn: () => void) => {
      video.addEventListener(type, fn);
      this.cleanup.push(() => video.removeEventListener(type, fn));
    };
    on('playing', this.onPlaying);
    on('pause', this.onPause);
    on('waiting', this.onWaiting);
    on('error', this.onVideoError);
    if (deps.win) {
      deps.win.addEventListener('online', this.onOnline);
      this.cleanup.push(() => deps.win!.removeEventListener('online', this.onOnline));
    }
    if (deps.doc) {
      deps.doc.addEventListener('visibilitychange', this.onVisibility);
      this.cleanup.push(() => deps.doc!.removeEventListener('visibilitychange', this.onVisibility));
    }
  }

  getState = (): PlaybackState => this.state;

  subscribe = (fn: (s: PlaybackState) => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get activeHlsInstances(): number {
    return this.hls ? 1 : 0;
  }

  private set(patch: Partial<PlaybackState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  /**
   * Starts a channel. The previous stream stops immediately; the new load can
   * be delayed slightly (delayMs) so rapid channel zapping only loads the last pick.
   */
  play(channel: PlayableChannel, delayMs = 0): void {
    const id = ++this.reqId;
    this.clearTimers();
    this.teardown();
    this.userPaused = false;
    const notes: string[] = [];
    if (isMixedContent(channel.streamUrl, this.deps.pageProtocol())) {
      notes.push('Uses http:// on an https:// page — the browser may block it.');
    }
    if (channel.directives?.length) {
      notes.push(`Provider asks for ${channel.directives.join(', ')}; browsers cannot send these, so it may not play.`);
    }
    this.engines = engineOrder(channel.streamUrl, this.enginePreference, canPlayNativeHls(this.video));
    this.set({ status: 'loading', channel, engine: undefined, error: undefined, attempt: 0, message: undefined, notes, requestId: id });
    if (!channel.streamUrl) {
      this.set({
        status: 'error',
        error: {
          diagnosis: 'unknown',
          title: 'Channel unavailable',
          detail: 'This saved channel is no longer in the source playlist. Refresh the source or find a replacement.',
          certain: true,
          retryable: false,
        },
      });
      return;
    }
    if (delayMs > 0) this.delayTimer = setTimeout(() => this.start(id, 0), delayMs);
    else this.start(id, 0);
  }

  /** User-initiated retry: resets the automatic retry budget. */
  retry(): void {
    if (this.state.channel) this.play(this.state.channel);
  }

  stop(): void {
    this.reqId++;
    this.clearTimers();
    this.teardown();
    this.set({ ...IDLE, requestId: this.reqId });
  }

  /** Must be called from a click/keydown handler so the browser treats it as a user gesture. */
  resume(): void {
    this.userPaused = false;
    if (this.state.status === 'needs-gesture') this.set({ status: 'loading', message: undefined });
    this.attemptPlay(this.reqId);
  }

  togglePause(): void {
    const s = this.state.status;
    if (s === 'playing' || s === 'buffering') {
      this.userPaused = true;
      this.video.pause();
      this.set({ status: 'paused' });
    } else if (s === 'paused' || s === 'needs-gesture') {
      this.resume();
    }
  }

  destroy(): void {
    this.stop();
    this.cleanup.forEach((fn) => fn());
    this.cleanup.length = 0;
    this.listeners.clear();
  }

  private isCurrent(id: number) {
    return id === this.reqId;
  }

  private clearTimers() {
    clearTimeout(this.startTimer);
    clearTimeout(this.stallTimer);
    clearTimeout(this.delayTimer);
    clearTimeout(this.retryTimer);
    this.startTimer = this.stallTimer = this.delayTimer = this.retryTimer = undefined;
  }

  /** Releases the engine and the decoder. Safe to call repeatedly. */
  private teardown() {
    if (this.hls) {
      try {
        this.hls.destroy();
      } catch {
        /* ignore */
      }
      this.hls = null;
    }
    const v = this.video;
    try {
      v.pause();
    } catch {
      /* ignore */
    }
    if (v.hasAttribute('src') || v.src) {
      v.removeAttribute('src');
      try {
        v.load();
      } catch {
        /* ignore */
      }
    }
  }

  private async start(id: number, engineIdx: number) {
    if (!this.isCurrent(id) || !this.state.channel) return;
    const url = this.state.channel.streamUrl;
    const engine = this.engines[engineIdx];
    this.engineIdx = engineIdx;
    this.mediaRecovered = false;
    this.hadPlayback = false;
    this.startedAt = Date.now();
    this.set({ engine });
    const hasFallback = engineIdx + 1 < this.engines.length;
    clearTimeout(this.startTimer);
    this.startTimer = setTimeout(() => this.fail(id, timeoutError('start')), hasFallback ? FALLBACK_START_TIMEOUT_MS : START_TIMEOUT_MS);

    if (engine === 'native') {
      this.video.src = url;
      try {
        this.video.load();
      } catch {
        /* ignore */
      }
      this.attemptPlay(id);
      return;
    }

    let HlsClass: HlsCtor;
    try {
      HlsClass = await this.deps.loadHls();
    } catch {
      if (!this.isCurrent(id)) return;
      this.fail(id, { diagnosis: 'network', title: 'Player component failed to load', detail: 'The hls.js playback module could not be downloaded. Check the connection and retry.', certain: true, retryable: true });
      return;
    }
    if (!this.isCurrent(id)) return;
    if (!HlsClass.isSupported()) {
      this.fail(id, { diagnosis: 'unsupported', title: 'hls.js not supported here', detail: 'This browser lacks the Media Source Extensions that hls.js needs.', certain: true, retryable: false });
      return;
    }
    const hls = new HlsClass(HLS_CONFIG);
    this.hls = hls;
    hls.on(HlsClass.Events.ERROR, (_evt, data: ErrorData) => {
      if (!this.isCurrent(id) || this.hls !== hls || !data.fatal) return;
      if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR && !this.mediaRecovered) {
        this.mediaRecovered = true;
        hls.recoverMediaError();
        return;
      }
      this.fail(id, fromHlsError(data as never, this.deps.isOnline()));
    });
    hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
      if (this.isCurrent(id) && this.hls === hls) this.attemptPlay(id);
    });
    hls.attachMedia(this.video);
    hls.loadSource(url);
  }

  private attemptPlay(id: number) {
    let p: Promise<void> | undefined;
    try {
      p = this.video.play();
    } catch {
      return; // Old engines without a play() promise report through media events.
    }
    if (p && typeof p.catch === 'function') {
      p.catch((err: { name?: string }) => {
        if (!this.isCurrent(id)) return;
        if (err?.name === 'NotAllowedError') {
          clearTimeout(this.startTimer);
          this.set({ status: 'needs-gesture', message: 'The browser blocked automatic playback. Press Play.' });
        }
        // AbortError means a newer load interrupted this one; other failures arrive as media errors.
      });
    }
  }

  private fail(id: number, error: PlaybackError) {
    if (!this.isCurrent(id)) return;
    this.clearTimers();
    let err = error;
    const channel = this.state.channel;
    if (channel && isMixedContent(channel.streamUrl, this.deps.pageProtocol()) && ['network', 'unsupported', 'unknown', 'timeout'].includes(err.diagnosis)) {
      err = mixedContentError(err.technical);
    }
    if (!this.deps.isOnline()) err = { ...offlineError(), technical: err.technical };

    const canFallback = this.engineIdx + 1 < this.engines.length && !this.hadPlayback && !['provider-http', 'offline', 'mixed-content'].includes(err.diagnosis);
    if (canFallback) {
      this.teardown();
      this.set({ message: `Trying ${this.engines[this.engineIdx + 1]} player…` });
      void this.start(id, this.engineIdx + 1);
      return;
    }
    const attempt = this.state.attempt;
    if (err.retryable && err.diagnosis !== 'offline' && attempt < MAX_RETRIES) {
      this.teardown();
      this.set({ status: 'loading', attempt: attempt + 1, message: `${err.title}. Retrying (${attempt + 1}/${MAX_RETRIES})…`, error: undefined });
      this.retryTimer = setTimeout(() => void this.start(id, 0), 2000 * (attempt + 1));
      return;
    }
    this.teardown();
    this.set({ status: 'error', error: err, message: undefined });
  }

  private onPlaying = () => {
    const id = this.reqId;
    if (this.state.status === 'idle' || !this.state.channel) return;
    clearTimeout(this.startTimer);
    clearTimeout(this.stallTimer);
    if (!this.hadPlayback) {
      this.hadPlayback = true;
      this.startTimings.unshift(Date.now() - this.startedAt);
      if (this.startTimings.length > 30) this.startTimings.length = 30;
    }
    if (this.isCurrent(id)) this.set({ status: 'playing', attempt: 0, message: undefined, error: undefined });
  };

  private onPause = () => {
    const s = this.state.status;
    if ((s === 'playing' || s === 'buffering') && this.video.paused) {
      clearTimeout(this.stallTimer);
      this.set({ status: 'paused' });
    }
  };

  private onWaiting = () => {
    if (this.state.status !== 'playing') return;
    const id = this.reqId;
    this.set({ status: 'buffering' });
    clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => this.fail(id, timeoutError('stall')), STALL_TIMEOUT_MS);
  };

  private onVideoError = () => {
    // hls.js reports its own errors; a src-less video (after teardown) is not an error.
    if (this.state.engine !== 'native' || !this.video.getAttribute('src')) return;
    if (this.state.status === 'idle' || this.state.status === 'error') return;
    this.fail(this.reqId, fromMediaError(this.video.error, this.deps.isOnline()));
  };

  private onOnline = () => {
    const s = this.state;
    if (s.status === 'error' && s.error && ['offline', 'network', 'timeout'].includes(s.error.diagnosis)) this.retry();
  };

  private onVisibility = () => {
    if (this.deps.doc?.visibilityState !== 'visible') return;
    const s = this.state;
    if (s.status === 'paused' && !this.userPaused) this.attemptPlay(this.reqId);
    else if (s.status === 'error' && s.error?.retryable) this.retry();
  };
}

export function createController(video: HTMLVideoElement): PlaybackController {
  return new PlaybackController(video, {
    loadHls: () => import('hls.js').then((m) => m.default),
    isOnline: () => (typeof navigator.onLine === 'boolean' ? navigator.onLine : true),
    pageProtocol: () => location.protocol,
    win: window,
    doc: document,
  });
}
