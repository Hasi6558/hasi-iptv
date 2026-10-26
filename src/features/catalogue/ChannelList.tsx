import { memo, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { Channel } from '../../lib/types';
import { navKey } from '../../lib/navigation/keys';
import { findByFocusId, focusElement } from '../../lib/navigation/focus';
import { Logo } from './Logo';

export const PAGE_SIZE = 40;

export type RowAction = { col: string; label: string; onActivate: () => void; className?: string; pressed?: boolean; ariaLabel?: string };

export type FocusRequest = { id: string; col?: string; nonce: number };

type Props = {
  items: Channel[];
  page: number;
  onPageChange: (page: number) => void;
  /** Ask the list to show and focus a channel. A new nonce re-triggers the same request. */
  focusRequest?: FocusRequest;
  onPlay: (channel: Channel) => void;
  actions?: (channel: Channel, index: number) => RowAction[];
  playingId?: string;
  showLogos: boolean;
  savedSet?: Set<string>;
  label: string;
};

export function rowFocusId(channelId: string, col = 'main'): string {
  return `ch:${channelId}|${col}`;
}

function parseFocusId(id: string | undefined): { channelId: string; col: string } | null {
  if (!id?.startsWith('ch:')) return null;
  const [channelId, col = 'main'] = id.slice(3).split('|');
  return { channelId, col };
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/**
 * Bounded channel list: renders one page of at most PAGE_SIZE rows. Up/Down
 * cross page boundaries; Left/Right move between a row's actions.
 */
export function ChannelList({ items, page, onPageChange, focusRequest, onPlay, actions, playingId, showLogos, savedSet, label }: Props) {
  const pages = pageCount(items.length);
  const safePage = Math.min(page, pages - 1);
  const start = safePage * PAGE_SIZE;
  const visible = items.slice(start, start + PAGE_SIZE);
  const pendingFocus = useRef<{ id: string; col: string } | null>(null);
  const lastNonce = useRef<number | undefined>(undefined);

  if (safePage !== page) void Promise.resolve().then(() => onPageChange(safePage));

  // Handle external focus requests (restore, removal neighbour, reorder).
  useLayoutEffect(() => {
    if (!focusRequest || focusRequest.nonce === lastNonce.current) return;
    lastNonce.current = focusRequest.nonce;
    const index = items.findIndex((c) => c.id === focusRequest.id);
    if (index < 0) return;
    pendingFocus.current = { id: focusRequest.id, col: focusRequest.col ?? 'main' };
    const targetPage = Math.floor(index / PAGE_SIZE);
    if (targetPage !== safePage) onPageChange(targetPage);
  });

  useLayoutEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    const el = findByFocusId(rowFocusId(p.id, p.col)) ?? findByFocusId(rowFocusId(p.id));
    if (el) {
      pendingFocus.current = null;
      focusElement(el);
    }
  });

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const k = navKey(e.nativeEvent);
    if (k !== 'up' && k !== 'down') return;
    const parsed = parseFocusId((e.target as HTMLElement).dataset.focusId);
    if (!parsed) return;
    const index = items.findIndex((c) => c.id === parsed.channelId);
    if (index < 0) return;
    const nextIndex = index + (k === 'down' ? 1 : -1);
    if (nextIndex < 0) return; // Let spatial navigation move to the controls above.
    e.preventDefault();
    if (nextIndex >= items.length) return;
    const target = items[nextIndex];
    pendingFocus.current = { id: target.id, col: parsed.col };
    const targetPage = Math.floor(nextIndex / PAGE_SIZE);
    if (targetPage !== safePage) onPageChange(targetPage);
    else {
      const el = findByFocusId(rowFocusId(target.id, parsed.col)) ?? findByFocusId(rowFocusId(target.id));
      if (el) {
        pendingFocus.current = null;
        focusElement(el);
      }
    }
  };

  return (
    <div className="channel-list">
      <ul className="rows" aria-label={label} onKeyDown={onKeyDown}>
        {visible.map((c, i) => (
          <Row
            key={c.id}
            channel={c}
            playing={c.id === playingId}
            saved={savedSet?.has(c.id)}
            showLogo={showLogos}
            actions={actions?.(c, start + i)}
            onPlay={onPlay}
            autofocus={i === 0}
          />
        ))}
      </ul>
      {pages > 1 && (
        <div className="pager">
          <button type="button" className="btn" disabled={safePage === 0} onClick={() => onPageChange(safePage - 1)} data-focus-id="pager:prev">
            ◀ Previous page
          </button>
          <span className="pager-info">
            Page {safePage + 1} of {pages} · {items.length.toLocaleString()} channels
          </span>
          <button type="button" className="btn" disabled={safePage >= pages - 1} onClick={() => onPageChange(safePage + 1)} data-focus-id="pager:next">
            Next page ▶
          </button>
        </div>
      )}
    </div>
  );
}

type RowProps = {
  channel: Channel;
  playing: boolean;
  saved?: boolean;
  showLogo: boolean;
  actions?: RowAction[];
  onPlay: (c: Channel) => void;
  autofocus: boolean;
};

const Row = memo(function Row({ channel: c, playing, saved, showLogo, actions, onPlay, autofocus }: RowProps): ReactNode {
  const unavailable = c.availability !== 'available' || !c.streamUrl;
  return (
    <li className={`row${playing ? ' is-playing' : ''}${unavailable ? ' is-unavailable' : ''}`}>
      <button type="button" className="row-main" data-focus-id={rowFocusId(c.id)} data-autofocus={autofocus || undefined} onClick={() => onPlay(c)} aria-label={`${c.name}${playing ? ', playing' : ''}`}>
        {showLogo && <Logo url={c.logoUrl} name={c.name} />}
        <span className="row-text">
          <span className="row-name">{c.name}</span>
          <span className="row-meta">
            {playing && <span className="badge badge-playing">▶ Playing</span>}
            {saved && <span className="badge badge-saved">★ Saved</span>}
            {c.availability === 'missing' && <span className="badge badge-warn">Missing from source</span>}
            {c.availability === 'needs-review' && <span className="badge badge-warn">Needs review</span>}
            {c.directives?.length ? <span className="badge badge-muted" title="Provider-specific headers">Needs headers</span> : null}
            {c.group && <span className="row-group">{c.group.split(';').join(' · ')}</span>}
          </span>
        </span>
      </button>
      {actions?.map((a) => (
        <button
          key={a.col}
          type="button"
          className={`btn row-action ${a.className ?? ''}`}
          data-focus-id={rowFocusId(c.id, a.col)}
          aria-pressed={a.pressed}
          aria-label={a.ariaLabel}
          onClick={a.onActivate}
        >
          {a.label}
        </button>
      ))}
    </li>
  );
});
