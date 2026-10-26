import { useState } from 'react';
import { useApp } from '../../app/context';
import { Dialog } from '../../app/Dialog';
import { clearPrefs } from '../../lib/storage/prefs';
import { describeStorageError } from '../../lib/storage/repository';

export function ClearDataSection() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelCount = app.channels.length;
  const savedCount = app.playlist.channelIds.length;

  const clear = async () => {
    try {
      app.controller?.stop();
      await app.repo.clearAll();
      clearPrefs();
      await app.reload();
      setOpen(false);
      app.notify({ kind: 'info', text: 'All local data was deleted.' });
      app.go('my');
    } catch (err) {
      setError(describeStorageError(err));
    }
  };

  return (
    <div className="panel">
      <h2>Privacy & local data</h2>
      <p className="hint">
        Your playlist URL is stored in this browser so the source can be refreshed. If it contains a username, password or token, anyone with access to this browser profile — or to a full backup — can
        see it. Stream URLs are also visible to this device while playing; a website cannot hide them.
      </p>
      <button type="button" className="btn btn-danger" data-focus-id="set:clear" onClick={() => setOpen(true)}>
        Clear all local data…
      </button>
      {open && (
        <Dialog
          title="Delete all local data?"
          onClose={() => setOpen(false)}
          actions={
            <button type="button" className="btn btn-danger" onClick={() => void clear()}>
              Yes, delete {savedCount} saved and {channelCount.toLocaleString()} catalogue channels
            </button>
          }
        >
          <p>This removes the source URL, the channel catalogue, My Channels and all settings from this browser. It cannot be undone. Export a backup first if you want to keep My Channels.</p>
          {error && <p className="notice notice-error">{error}</p>}
        </Dialog>
      )}
    </div>
  );
}
