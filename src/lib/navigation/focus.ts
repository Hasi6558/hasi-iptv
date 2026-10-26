export type Direction = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The topmost open dialog (data-nav-scope) traps navigation; otherwise the whole app. */
export function activeScope(root: ParentNode = document): HTMLElement | null {
  const scopes = root.querySelectorAll<HTMLElement>('[data-nav-scope]');
  return scopes.length ? scopes[scopes.length - 1] : document.getElementById('root');
}

function isVisible(el: HTMLElement): boolean {
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function focusables(scope: HTMLElement | null = activeScope()): HTMLElement[] {
  if (!scope) return [];
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
}

function escapeAttr(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}

export function findByFocusId(id: string, scope: ParentNode = document): HTMLElement | null {
  return scope.querySelector<HTMLElement>(`[data-focus-id="${escapeAttr(id)}"]`);
}

/** Focuses without scrolling the page unexpectedly, then keeps the element in view. */
export function focusElement(el: HTMLElement | null): boolean {
  if (!el) return false;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
  if (typeof el.scrollIntoView === 'function') {
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch {
      el.scrollIntoView(false);
    }
  }
  return document.activeElement === el;
}

export function focusById(id: string | undefined): boolean {
  return id ? focusElement(findByFocusId(id)) : false;
}

/**
 * Focuses the first usable element marked data-autofocus in the active scope,
 * else the first focusable element of the main content, else of the scope.
 */
export function focusDefault(scope: HTMLElement | null = activeScope()): boolean {
  if (!scope) return false;
  const usable = (el: HTMLElement) => isVisible(el) && !(el as HTMLButtonElement).disabled;
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>('[data-autofocus]'))) {
    if (usable(el) && focusElement(el)) return true;
  }
  const main = scope.querySelector<HTMLElement>('main');
  if (main && focusElement(focusables(main)[0] ?? null)) return true;
  return focusElement(focusables(scope)[0] ?? null);
}

type Rect = { left: number; right: number; top: number; bottom: number };

/**
 * Geometric neighbour search. Candidates must lie in the requested direction;
 * the score favours small travel along the axis and heavily penalises
 * sideways offset. Ties resolve to DOM order, so the result is deterministic.
 */
export function pickNeighbour(from: Rect, candidates: Rect[], dir: Direction): number {
  const cx = (from.left + from.right) / 2;
  const cy = (from.top + from.bottom) / 2;
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((r, i) => {
    let primary: number;
    let secondary: number;
    const rcx = (r.left + r.right) / 2;
    const rcy = (r.top + r.bottom) / 2;
    switch (dir) {
      case 'up':
        if (r.bottom > from.top + 1 && rcy >= cy) return;
        primary = Math.max(0, from.top - r.bottom);
        secondary = r.right < from.left ? from.left - r.right : r.left > from.right ? r.left - from.right : 0;
        break;
      case 'down':
        if (r.top < from.bottom - 1 && rcy <= cy) return;
        primary = Math.max(0, r.top - from.bottom);
        secondary = r.right < from.left ? from.left - r.right : r.left > from.right ? r.left - from.right : 0;
        break;
      case 'left':
        if (r.right > from.left + 1 && rcx >= cx) return;
        primary = Math.max(0, from.left - r.right);
        secondary = r.bottom < from.top ? from.top - r.bottom : r.top > from.bottom ? r.top - from.bottom : 0;
        break;
      case 'right':
        if (r.left < from.right - 1 && rcx <= cx) return;
        primary = Math.max(0, r.left - from.right);
        secondary = r.bottom < from.top ? from.top - r.bottom : r.top > from.bottom ? r.top - from.bottom : 0;
        break;
    }
    const score = primary + secondary * 3;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export function moveFocus(dir: Direction): boolean {
  const scope = activeScope();
  const items = focusables(scope);
  if (!items.length) return false;
  const current = document.activeElement as HTMLElement | null;
  if (!current || !scope?.contains(current) || current === document.body) return focusDefault(scope);
  const others = items.filter((el) => el !== current);
  const idx = pickNeighbour(current.getBoundingClientRect(), others.map((el) => el.getBoundingClientRect()), dir);
  return idx >= 0 ? focusElement(others[idx]) : false;
}
