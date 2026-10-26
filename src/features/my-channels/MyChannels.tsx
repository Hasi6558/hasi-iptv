import { useMemo, useRef, useState } from 'react';
import { useApp, usePlayingId } from '../../app/context';
import type { Channel } from '../../lib/types';
import { neighbourAfterRemoval } from '../../lib/navigation/activeList';
import { ChannelList, PAGE_SIZE, type FocusRequest, type RowAction } from '../catalogue/ChannelList';

export function MyChannels() {
  const app = useApp();
  const { playlist, channelMap, prefs, controller } = app;
  const playingId = usePlayingId(controller);
  const [editing, setEditing] = useState(false);
  const nonce = useRef(1);

  const items = useMemo(
    () => playlist.channelIds.map((id) => channelMap.get(id)).filter((c): c is Channel => !!c),
    [playlist, channelMap],
  );
  const ids = useMemo(() => items.map((c) => c.id), [items]);

  // Restore the last focused channel (or the returning player's channel) without starting playback.
  const [focusRequest, setFocusRequest] = useState<FocusRequest | undefined>(() => {
    const remembered = app.focusMemory.my;
    const fromMemory = remembered?.startsWith('ch:') ? remembered.slice(3).split('|') : undefined;
    const id = fromMemory?.[0] ?? prefs.lastFocusedMyChannel;
    return id && channelMap.has(id) ? { id, col: fromMemory?.[1] ?? 'main', nonce: nonce.current++ } : undefined;
  });
  const [page, setPage] = useState(() => {
    const idx = focusRequest ? ids.indexOf(focusRequest.id) : -1;
    return idx > 0 ? Math.floor(idx / PAGE_SIZE) : 0;
  });

  const request = (id: string, col: string) => setFocusRequest({ id, col, nonce: nonce.current++ });

  const remove = (c: Channel, index: number) => {
    app.removeFromMy(c.id);
    const remaining = ids.filter((x) => x !== c.id);
    const n = neighbourAfterRemoval(index, remaining.length);
    if (n >= 0) request(remaining[n], 'remove');
  };

  const actions = (c: Channel, index: number): RowAction[] => {
    const list: RowAction[] = [];
    if (editing) {
      list.push(
        { col: 'up', label: '▲ Up', ariaLabel: `Move ${c.name} up`, onActivate: () => index > 0 && (app.moveInMy(c.id, -1), request(c.id, 'up')) },
        { col: 'down', label: '▼ Down', ariaLabel: `Move ${c.name} down`, onActivate: () => index < ids.length - 1 && (app.moveInMy(c.id, 1), request(c.id, 'down')) },
        { col: 'remove', label: 'Remove', className: 'btn-danger', ariaLabel: `Remove ${c.name} from My Channels`, onActivate: () => remove(c, index) },
      );
    } else if (c.availability !== 'available' || !c.streamUrl) {
      list.push({
        col: 'find',
        label: 'Find',
        ariaLabel: `Find a replacement for ${c.name}`,
        onActivate: () => {
          app.setCatalogueView({ query: c.name.replace(/\(.*?\)|\[.*?\]/g, '').trim(), group: '', page: 0 });
          app.go('all');
        },
      });
    }
    return list;
  };

  const hasCatalogue = app.channels.some((c) => c.availability === 'available');
  const problems = items.filter((c) => c.availability !== 'available').length;

  return (
    <section className="screen" aria-labelledby="my-title">
      <header className="screen-header">
        <h1 id="my-title">My Channels</h1>
        <span className="screen-count">{items.length ? `${items.length} saved` : ''}</span>
        <div className="header-actions">
          <button type="button" className="btn" data-focus-id="my:add" onClick={() => app.go('all')}>
            ＋ Add channels
          </button>
          {items.length > 0 && (
            <button type="button" className={`btn${editing ? ' btn-primary' : ''}`} data-focus-id="my:edit" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
              {editing ? 'Done editing' : 'Edit order'}
            </button>
          )}
        </div>
      </header>
      {problems > 0 && !editing && (
        <p className="hint hint-warn">
          {problems} saved channel{problems === 1 ? ' is' : 's are'} missing from the current source or need review. Use Find to pick a replacement, or Edit order → Remove.
        </p>
      )}
      {items.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No saved channels yet</p>
          <p>{hasCatalogue ? 'Browse the catalogue and press ☆ Add on the channels you watch.' : 'Import your M3U playlist first, then pick the channels you watch.'}</p>
          <div className="empty-actions">
            <button type="button" className="btn btn-primary" data-autofocus onClick={() => app.go(hasCatalogue ? 'all' : 'settings')}>
              {hasCatalogue ? 'Browse channels' : 'Import source'}
            </button>
            <button type="button" className="btn" onClick={() => app.go(hasCatalogue ? 'settings' : 'all')}>
              {hasCatalogue ? 'Import source' : 'Browse channels'}
            </button>
          </div>
        </div>
      ) : (
        <ChannelList
          label="My Channels"
          items={items}
          page={page}
          onPageChange={setPage}
          focusRequest={focusRequest}
          onPlay={(c) => app.playChannel(c.id, 'my', ids)}
          actions={actions}
          playingId={playingId}
          showLogos={prefs.showLogos}
        />
      )}
    </section>
  );
}
