import { LIMITS } from './parser';
import { CancelledError } from './parseAsync';

export class ImportError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

function tooLarge(bytes: number): ImportError {
  const mb = (LIMITS.maxPlaylistBytes / 1024 / 1024).toFixed(0);
  return new ImportError(`Playlist is larger than the ${mb} MB limit (${(bytes / 1024 / 1024).toFixed(1)} MB).`);
}

/** Downloads a playlist with progress, size limit and cancellation. */
export async function fetchPlaylistText(
  url: string,
  onProgress: (bytes: number, total?: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (location.protocol === 'https:' && url.startsWith('http:')) {
    // Browsers block (or auto-upgrade) HTTP requests from HTTPS pages.
    throw new ImportError(
      'This is an HTTP playlist URL, but the app is served over HTTPS.',
      'The browser blocks this request. Use an HTTPS playlist URL, or download the file and use Import file.',
    );
  }
  let res: Response;
  try {
    res = await fetch(url, { signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  } catch (err) {
    if (signal?.aborted) throw new CancelledError();
    throw new ImportError(
      'Could not download the playlist.',
      'The provider may block cross-origin (CORS) requests, the address may be wrong, or the network is offline. Browsers do not reveal which. Try Import file instead.',
    );
  }
  if (!res.ok) {
    throw new ImportError(`The provider responded with HTTP ${res.status}.`, res.status === 401 || res.status === 403 ? 'Check that the URL and its token are still valid.' : undefined);
  }
  const lengthHeader = Number(res.headers.get('content-length'));
  const total = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : undefined;
  if (total && total > LIMITS.maxPlaylistBytes) throw tooLarge(total);

  if (!res.body || typeof TextDecoder === 'undefined') {
    const text = await res.text();
    if (text.length > LIMITS.maxPlaylistBytes) throw tooLarge(text.length);
    onProgress(text.length, total);
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parts: string[] = [];
  let received = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      if (signal?.aborted) throw new CancelledError();
      throw new ImportError('The download was interrupted.');
    }
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > LIMITS.maxPlaylistBytes) {
      reader.cancel().catch(() => undefined);
      throw tooLarge(received);
    }
    parts.push(decoder.decode(chunk.value, { stream: true }));
    onProgress(received, total);
  }
  parts.push(decoder.decode());
  return parts.join('');
}

export async function readPlaylistFile(file: File): Promise<string> {
  if (file.size > LIMITS.maxPlaylistBytes) throw tooLarge(file.size);
  return readTextFile(file);
}

/** File.text() with a FileReader fallback for older engines. */
export function readTextFile(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImportError('Could not read the file.'));
    reader.readAsText(file);
  });
}
