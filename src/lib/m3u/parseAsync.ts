import { M3UParser, type ParseOptions, type ParseResult } from './parser';
import ParseWorker from '../../workers/parse.worker?worker';

export type ParseProgress = (fraction: number) => void;

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

/** Main-thread fallback: parses in small slices and yields to keep the UI responsive. */
export function parseChunked(
  text: string,
  options: ParseOptions,
  onProgress: ParseProgress,
  signal?: AbortSignal,
): Promise<ParseResult> {
  const parser = new M3UParser(text, options);
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (signal?.aborted) return reject(new CancelledError());
      try {
        const started = Date.now();
        let done = false;
        // Work for ~12 ms per slice, then yield to input handling.
        while (!done && Date.now() - started < 12) done = parser.step(500);
        onProgress(parser.progress);
        if (done) resolve(parser.result());
        else setTimeout(tick, 0);
      } catch (err) {
        reject(err);
      }
    };
    tick();
  });
}

/** Parses in a Web Worker when available, falling back to chunked main-thread parsing. */
export function parsePlaylist(
  text: string,
  options: ParseOptions,
  onProgress: ParseProgress,
  signal?: AbortSignal,
): Promise<ParseResult> {
  let worker: Worker;
  try {
    if (typeof Worker === 'undefined') throw new Error('no worker');
    worker = new ParseWorker();
  } catch {
    return parseChunked(text, options, onProgress, signal);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      settled = true;
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      finish();
      reject(new CancelledError());
    };
    signal?.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') onProgress(msg.progress);
      else if (msg.type === 'done') {
        finish();
        resolve(msg.result as ParseResult);
      } else if (msg.type === 'error') {
        finish();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      // Worker failed to load or crashed (e.g. unsupported syntax): fall back.
      e.preventDefault();
      if (settled) return;
      finish();
      parseChunked(text, options, onProgress, signal).then(resolve, reject);
    };
    worker.postMessage({ text, options });
  });
}
