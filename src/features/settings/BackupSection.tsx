import { useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Dialog } from '../../app/Dialog';
import { newId } from '../../lib/id';
import type { Source } from '../../lib/types';
import {
  BackupError,
  createFullBackup,
  createPersonalBackup,
  MAX_BACKUP_BYTES,
  parseBackup,
  planPersonalRestore,
  type Backup,
  type PersonalRestorePlan,
} from '../../lib/storage/backup';
import { describeStorageError } from '../../lib/storage/repository';
import { readTextFile } from '../../lib/m3u/fetchText';

function downloadSupported(): boolean {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && 'download' in document.createElement('a');
}

function download(name: string, data: unknown): boolean {
  if (!downloadSupported()) return false;
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
  return true;
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

type Pending = { backup: Backup; plan?: PersonalRestorePlan };

export function BackupSection() {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmFull, setConfirmFull] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [working, setWorking] = useState(false);

  const exportPersonal = () => {
    const ok = download(`hasi-iptv-my-channels-${stamp()}.json`, createPersonalBackup(app.playlist, app.channelMap, app.prefs));
    setMessage(ok ? { kind: 'info', text: 'Personal backup downloaded.' } : { kind: 'error', text: 'This browser cannot download files. Make backups from a desktop browser.' });
  };

  const exportFull = async () => {
    setConfirmFull(false);
    try {
      const snapshot = await app.repo.loadAll();
      const ok = download(`hasi-iptv-full-backup-${stamp()}.json`, createFullBackup(snapshot, app.prefs));
      setMessage(ok ? { kind: 'info', text: 'Full backup downloaded. Keep it private: it contains your playlist URL.' } : { kind: 'error', text: 'This browser cannot download files.' });
    } catch (err) {
      setMessage({ kind: 'error', text: describeStorageError(err) });
    }
  };

  const onFile = async (file: File) => {
    setMessage(null);
    if (file.size > MAX_BACKUP_BYTES) {
      setMessage({ kind: 'error', text: 'Backup file is too large.' });
      return;
    }
    try {
      const backup = parseBackup(await readTextFile(file));
      if (backup.kind === 'personal') {
        const catalogue = app.channels.filter((c) => c.streamUrl);
        const plan = planPersonalRestore(backup, catalogue, app.source?.id ?? 'pending', () => newId('ch'));
        setPending({ backup, plan });
      } else setPending({ backup });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof BackupError ? err.message : 'Could not read the backup file.' });
    }
  };

  const apply = async () => {
    if (!pending) return;
    setWorking(true);
    try {
      const { backup, plan } = pending;
      if (backup.kind === 'full') {
        await app.repo.replaceAll(backup.data);
      } else if (plan) {
        const source: Source = app.source ?? { id: newId('src'), name: 'Restored backup', kind: 'url' };
        const placeholders = plan.placeholders.map((p) => ({ ...p, sourceId: source.id }));
        const keep = new Set(plan.channelIds);
        // Old placeholders no longer referenced by My Channels are removed.
        const stale = app.channels.filter((c) => !c.streamUrl && !keep.has(c.id)).map((c) => c.id);
        await app.repo.commitCatalogue({
          source,
          channels: placeholders,
          deleteChannelIds: stale,
          playlist: { ...app.playlist, channelIds: plan.channelIds },
        });
      }
      app.setPrefs(backup.settings);
      await app.reload();
      setMessage({ kind: 'info', text: 'Backup restored.' });
      setPending(null);
    } catch (err) {
      setMessage({ kind: 'error', text: `Restore failed; nothing was changed. ${describeStorageError(err)}` });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="panel">
      <h2>Backup & restore</h2>
      <div className="button-row">
        <button type="button" className="btn" data-focus-id="set:backup" onClick={exportPersonal} disabled={!app.playlist.channelIds.length}>
          Export My Channels backup
        </button>
        <button type="button" className="btn" data-focus-id="set:backup-full" onClick={() => setConfirmFull(true)}>
          Export full backup…
        </button>
        <button type="button" className="btn" data-focus-id="set:restore" onClick={() => fileRef.current?.click()}>
          Restore from file…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onFile(f);
          }}
        />
      </div>
      <p className="hint">
        The My Channels backup contains channel names, IDs, order and settings — no URLs or tokens. Restoring it matches channels against your current source. The full backup also contains your
        playlist URL and every stream URL. TV browsers often cannot download or upload files; use a desktop browser on the same site if needed (data does not sync between devices).
      </p>
      {message && (
        <div className={`notice notice-${message.kind}`} role="status">
          <span>{message.text}</span>
        </div>
      )}

      {confirmFull && (
        <Dialog
          title="Export full backup?"
          onClose={() => setConfirmFull(false)}
          actions={
            <button type="button" className="btn btn-danger" onClick={() => void exportFull()}>
              Export with private URLs
            </button>
          }
        >
          <p>The full backup includes your playlist URL and all stream URLs, which may contain your account token or password. Store it somewhere private and do not share it.</p>
        </Dialog>
      )}

      {pending && (
        <Dialog
          title="Restore backup?"
          onClose={() => setPending(null)}
          actions={
            <button type="button" className="btn btn-danger" disabled={working} onClick={() => void apply()}>
              {working ? 'Restoring…' : pending.backup.kind === 'full' ? 'Replace all data' : 'Replace My Channels'}
            </button>
          }
        >
          {pending.backup.kind === 'full' ? (
            <>
              <p>
                Full backup from {pending.backup.createdAt ? new Date(pending.backup.createdAt).toLocaleString() : 'an unknown date'}: {pending.backup.data.sources.length} source(s),{' '}
                {pending.backup.data.channels.length.toLocaleString()} channels, {pending.backup.data.playlists[0]?.channelIds.length ?? 0} saved.
              </p>
              <p>This replaces everything stored in this browser, including your current source and My Channels ({app.playlist.channelIds.length} channels).</p>
            </>
          ) : (
            pending.plan && (
              <>
                <p>
                  {pending.plan.matched} of {pending.backup.playlist.entries.length} saved channels match the current source.
                  {pending.plan.unmatched > 0 && ` ${pending.plan.unmatched} will be kept as “missing” until you import a source that contains them.`}
                </p>
                <p>This replaces your current My Channels ({app.playlist.channelIds.length} channels). The source catalogue is not changed.</p>
              </>
            )
          )}
        </Dialog>
      )}
    </div>
  );
}
