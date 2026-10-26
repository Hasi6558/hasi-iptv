export type NavKey = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back';

/**
 * Maps a keyboard event to a navigation action. Only standard key values and
 * their legacy keyCodes are used; TV-specific codes are added only after they
 * have been observed on the device (see Diagnostics → Received keys).
 */
export function navKey(e: KeyboardEvent): NavKey | null {
  switch (e.key) {
    case 'ArrowUp':
    case 'Up':
      return 'up';
    case 'ArrowDown':
    case 'Down':
      return 'down';
    case 'ArrowLeft':
    case 'Left':
      return 'left';
    case 'ArrowRight':
    case 'Right':
      return 'right';
    case 'Enter':
      return 'ok';
    case 'Escape':
    case 'Esc':
    case 'Backspace':
    case 'GoBack':
    case 'BrowserBack':
      return 'back';
  }
  switch (e.keyCode) {
    case 38:
      return 'up';
    case 40:
      return 'down';
    case 37:
      return 'left';
    case 39:
      return 'right';
    case 13:
      return 'ok';
    case 27:
    case 8:
      return 'back';
  }
  return null;
}

export function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color'].includes(el.type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

/** Small ring buffer of received keys for the diagnostics panel. Never stores text typed into inputs. */
export type KeyLogEntry = { key: string; code: string; keyCode: number; at: number };
let keyLog: KeyLogEntry[] = [];
const keyListeners = new Set<() => void>();

export function recordKey(e: KeyboardEvent): void {
  if (isTextEntry(e.target as Element) && e.key.length === 1) return;
  // Replaced, not mutated, so useSyncExternalStore sees a new snapshot.
  keyLog = [{ key: String(e.key), code: String(e.code ?? ''), keyCode: e.keyCode, at: Date.now() }, ...keyLog].slice(0, 15);
  keyListeners.forEach((l) => l());
}

export function getKeyLog(): readonly KeyLogEntry[] {
  return keyLog;
}

export function subscribeKeyLog(l: () => void): () => void {
  keyListeners.add(l);
  return () => keyListeners.delete(l);
}
