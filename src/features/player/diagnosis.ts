export type Diagnosis =
  | 'unsupported'
  | 'network'
  | 'mixed-content'
  | 'provider-http'
  | 'timeout'
  | 'offline'
  | 'headers-required'
  | 'unknown';

export type PlaybackError = {
  diagnosis: Diagnosis;
  title: string;
  detail: string;
  /** False when the browser does not expose enough information to be sure. */
  certain: boolean;
  /** Whether an automatic retry is worthwhile. */
  retryable: boolean;
  httpStatus?: number;
  /** The stream was downloaded but could not be parsed/decoded, so it was not blocked. */
  dataReceived?: boolean;
  /** Raw engine detail for diagnostics (never contains the URL). */
  technical?: string;
};

export function isMixedContent(url: string, pageProtocol: string): boolean {
  return pageProtocol === 'https:' && /^http:/i.test(url);
}

export function mixedContentError(technical?: string): PlaybackError {
  return {
    diagnosis: 'mixed-content',
    title: 'HTTP stream blocked on HTTPS page',
    detail: 'This channel uses http://. Browsers block or auto-upgrade insecure media on secure pages, and this provider may not offer HTTPS. This cannot be bypassed from the app.',
    certain: false,
    retryable: false,
    technical,
  };
}

export function offlineError(): PlaybackError {
  return {
    diagnosis: 'offline',
    title: 'Network offline',
    detail: 'The TV reports no network connection. Playback will retry when the connection returns.',
    certain: true,
    retryable: true,
  };
}

export function timeoutError(phase: 'start' | 'stall'): PlaybackError {
  return {
    diagnosis: 'timeout',
    title: phase === 'start' ? 'Channel did not start' : 'Stream stopped',
    detail: phase === 'start' ? 'No video arrived in time. The provider may be slow, offline or geo-blocked.' : 'No new video data arrived for a while.',
    certain: false,
    retryable: true,
  };
}

/** Maps hls.js fatal error data. See https://github.com/video-dev/hls.js/blob/master/docs/API.md#errors */
export function fromHlsError(data: { type?: string; details?: string; response?: { code?: number }; error?: { message?: string } }, online: boolean): PlaybackError {
  const technical = `hls.js ${data.type ?? ''}/${data.details ?? ''}${data.response?.code !== undefined ? ` (${data.response.code})` : ''}`;
  if (!online) return { ...offlineError(), technical };
  const details = data.details ?? '';
  if (data.type === 'networkError') {
    const code = data.response?.code ?? 0;
    if (code >= 400) {
      return {
        diagnosis: 'provider-http',
        title: `Provider responded HTTP ${code}`,
        detail: code === 401 || code === 403 ? 'Access denied. The link may have expired, need a token, or be geo-blocked.' : code === 404 ? 'The stream was not found. The link may be outdated.' : 'The provider returned an error.',
        certain: true,
        retryable: code >= 500 || code === 429,
        httpStatus: code,
        technical,
      };
    }
    if (details === 'manifestParsingError') {
      return { diagnosis: 'unsupported', title: 'Not a playable HLS stream', detail: 'The address did not return a valid HLS manifest.', certain: true, retryable: false, technical };
    }
    return {
      diagnosis: 'network',
      title: 'Stream request blocked or unreachable',
      detail: 'The browser could not load the stream. Likely causes: the provider does not allow cross-origin (CORS) playback, the server is down, or the stream is geo-blocked. Browsers do not reveal which.',
      certain: false,
      retryable: true,
      technical,
    };
  }
  if (data.type === 'keySystemError') {
    return { diagnosis: 'unsupported', title: 'Protected (DRM) stream', detail: 'This stream uses DRM that the browser cannot play.', certain: true, retryable: false, technical };
  }
  if (data.type === 'mediaError') {
    return {
      diagnosis: 'unsupported',
      title: 'Video format not supported',
      detail: 'The browser could not decode this stream (for example HEVC/H.265 or an unusual audio codec).',
      certain: details.includes('Codec') || details.includes('codec'),
      retryable: false,
      technical,
    };
  }
  return { diagnosis: 'unknown', title: 'Playback failed', detail: 'An unexpected playback error occurred.', certain: false, retryable: true, technical };
}

/** Maps HTMLMediaElement.error. Native players expose little detail, so most diagnoses are uncertain. */
export function fromMediaError(err: MediaError | null, online: boolean): PlaybackError {
  const code = err?.code ?? 0;
  const technical = `MediaError ${code}${err?.message ? `: ${err.message}` : ''}`;
  if (!online) return { ...offlineError(), technical };
  // Chromium reports demuxer failures in the message: bytes arrived but the format was unreadable.
  if (/DEMUXER_ERROR|COULD_NOT_PARSE|NO_SUPPORTED_STREAMS/i.test(err?.message ?? '')) {
    return {
      diagnosis: 'unsupported',
      title: 'Stream format not supported by this player',
      detail: 'The stream was reached, but this browser could not read its format. Try the other player engine in Settings, or another stream of this channel.',
      certain: true,
      retryable: false,
      dataReceived: true,
      technical,
    };
  }
  switch (code) {
    case 2:
      return { diagnosis: 'network', title: 'Network error while loading', detail: 'The stream could not be downloaded. The server may be down or blocking this device.', certain: false, retryable: true, technical };
    case 3:
      return { diagnosis: 'unsupported', title: 'Video could not be decoded', detail: 'The stream format or codec is not supported by this browser.', certain: false, retryable: false, technical };
    case 4:
      return {
        diagnosis: 'unsupported',
        title: 'Stream not supported or unreachable',
        detail: 'The browser rejected the source. It may be an unsupported format, or the server may be unreachable — native players report both the same way.',
        certain: false,
        retryable: true,
        technical,
      };
    default:
      return { diagnosis: 'unknown', title: 'Playback failed', detail: 'The player stopped with an unknown error.', certain: false, retryable: true, technical };
  }
}
