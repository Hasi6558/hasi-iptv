type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
  webkitFullscreenEnabled?: boolean;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => void };

export function fullscreenElement(): Element | null {
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

export function fullscreenSupported(): boolean {
  const d = document as FsDocument;
  const el = document.documentElement as FsElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen) && d.fullscreenEnabled !== false && d.webkitFullscreenEnabled !== false;
}

/**
 * Requests real fullscreen. Must run synchronously inside a click/keydown
 * handler, before any network wait, or browsers reject it. Resolves to false
 * on rejection; the caller keeps the CSS full-window layout either way.
 */
export function requestFullscreen(el: HTMLElement): Promise<boolean> {
  if (fullscreenElement()) return Promise.resolve(true);
  const target = el as FsElement;
  try {
    if (target.requestFullscreen) {
      const p = target.requestFullscreen();
      return p && typeof p.then === 'function' ? p.then(() => true, () => false) : Promise.resolve(true);
    }
    if (target.webkitRequestFullscreen) {
      target.webkitRequestFullscreen();
      return Promise.resolve(true);
    }
  } catch {
    /* fall through */
  }
  return Promise.resolve(false);
}

export function exitFullscreen(): void {
  const d = document as FsDocument;
  if (!fullscreenElement()) return;
  try {
    if (d.exitFullscreen) d.exitFullscreen().catch(() => undefined);
    else d.webkitExitFullscreen?.();
  } catch {
    /* ignore */
  }
}

export function onFullscreenChange(fn: () => void): () => void {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
  return () => {
    document.removeEventListener('fullscreenchange', fn);
    document.removeEventListener('webkitfullscreenchange', fn);
  };
}
