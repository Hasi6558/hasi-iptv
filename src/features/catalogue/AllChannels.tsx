import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, usePlayingId } from '../../app/context';
import { Dialog } from '../../app/Dialog';
import type { Channel } from '../../lib/types';
import { splitGroups } from '../../lib/m3u/normalize';
import { filterChannels } from './filter';
import { ChannelList, type FocusRequest, type RowAction } from './ChannelList';

const SEARCH_DEBOUNCE_MS = 200;
const MAX_GROUPS_SHOWN = 500;

export function AllChannels() {
  const app = useApp();
  const { channels, catalogueView: view, setCatalogueView, savedSet, prefs, controller } = app;
  const playingId = usePlayingId(controller);
  const [input, setInput] = useState(view.query);
  const [showGroups, setShowGroups] = useState(false);

  // Debounce search input; filtering 10k+ normalized names is cheap, rerendering on each key is not.
  useEffect(() => {
    if (input === view.query) return;
    const t = setTimeout(() => setCatalogueView({ query: input, page: 0 }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input, view.query, setCatalogueView]);

  // External query changes (e.g. "Find" from My Channels).
  const lastQuery = useRef(view.query);
  useEffect(() => {
    if (view.query !== lastQuery.current) {
      lastQuery.current = view.query;
      setInput(view.query);
    }
  }, [view.query]);

  const items = useMemo(() => filterChannels(channels, view.query, view.group), [channels, view.query, view.group]);
  const ids = useMemo(() => items.map((c) => c.id), [items]);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of channels) {
      if (!c.streamUrl) continue;
      for (const g of splitGroups(c.group)) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [channels]);

  // Restore the focused channel when coming back from the player or another screen.
  const [focusRequest] = useState<FocusRequest | undefined>(() => {
    const remembered = app.focusMemory.all;
    if (!remembered?.startsWith('ch:')) return undefined;
    const [id, col] = remembered.slice(3).split('|');
    return { id, col, nonce: 1 };
  });

  const actions = (c: Channel): RowAction[] => {
    const saved = savedSet.has(c.id);
    return [
      {
        col: 'fav',
        label: saved ? '★ Saved' : '☆ Add',
        className: saved ? 'btn-saved' : '',
        pressed: saved,
        ariaLabel: saved ? `Remove ${c.name} from My Channels` : `Add ${c.name} to My Channels`,
        onActivate: () => (saved ? app.removeFromMy(c.id) : app.addToMy(c.id)),
      },
    ];
  };

  const imp = app.lastImport;
  const warningTotal = imp ? Object.values(imp.warningCounts).reduce((a, b) => a + (b ?? 0), 0) : 0;

  return (
    <section className="screen" aria-labelledby="all-title">
      <header className="screen-header">
        <h1 id="all-title">All Channels</h1>
        <span className="screen-count">{channels.length ? `${items.length.toLocaleString()} shown` : ''}</span>
      </header>
      {channels.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No catalogue imported</p>
          <p>Import your M3U playlist URL or file in Settings.</p>
          <button type="button" className="btn btn-primary" data-autofocus onClick={() => app.go('settings')}>
            Import source
          </button>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <label className="search">
              <span className="sr-only">Search channels</span>
              <input
                type="search"
                data-focus-id="all:search"
                placeholder="Search channels…"
                value={input}
                maxLength={100}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setInput(e.target.value)}
              />
            </label>
            <button type="button" className="btn" data-focus-id="all:category" onClick={() => setShowGroups(true)}>
              Category: {view.group || 'All'}
            </button>
            {(view.query || view.group) && (
              <button
                type="button"
                className="btn"
                data-focus-id="all:clear"
                onClick={() => {
                  setInput('');
                  setCatalogueView({ query: '', group: '', page: 0 });
                }}
              >
                Clear filters
              </button>
            )}
          </div>
          {warningTotal > 0 && (
            <p className="hint">
              Last import skipped or flagged {warningTotal.toLocaleString()} entr{warningTotal === 1 ? 'y' : 'ies'}. Details are in Settings.
            </p>
          )}
          {items.length === 0 ? (
            <p className="empty">No channels match.</p>
          ) : (
            <ChannelList
              label="All channels"
              items={items}
              page={view.page}
              onPageChange={(page) => setCatalogueView({ page })}
              focusRequest={focusRequest}
              onPlay={(c) => app.playChannel(c.id, 'all', ids)}
              actions={actions}
              playingId={playingId}
              showLogos={prefs.showLogos}
              savedSet={savedSet}
            />
          )}
        </>
      )}
      {showGroups && (
        <Dialog title="Choose category" onClose={() => setShowGroups(false)} wide>
          <div className="group-grid">
            <button
              type="button"
              className={`btn${view.group === '' ? ' btn-primary' : ''}`}
              data-autofocus={view.group === '' || undefined}
              onClick={() => {
                setCatalogueView({ group: '', page: 0 });
                setShowGroups(false);
              }}
            >
              All categories
            </button>
            {groups.slice(0, MAX_GROUPS_SHOWN).map(([g, n]) => (
              <button
                key={g}
                type="button"
                className={`btn${view.group === g ? ' btn-primary' : ''}`}
                data-autofocus={view.group === g || undefined}
                onClick={() => {
                  setCatalogueView({ group: g, page: 0 });
                  setShowGroups(false);
                }}
              >
                {g} <span className="muted">({n})</span>
              </button>
            ))}
          </div>
          {groups.length > MAX_GROUPS_SHOWN && <p className="hint">Showing the first {MAX_GROUPS_SHOWN} categories. Use search to narrow down.</p>}
        </Dialog>
      )}
    </section>
  );
}
