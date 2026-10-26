import type { Channel, PersonalPlaylist, Source } from '../../lib/types';
import { newId } from '../../lib/id';
import { describeKind, type ParseResult, type ParseWarning, type WarningCode } from '../../lib/m3u/parser';
import { parsePlaylist } from '../../lib/m3u/parseAsync';
import { fetchPlaylistText, ImportError, readPlaylistFile } from '../../lib/m3u/fetchText';
import { reconcile, type ReconcileStats } from '../../lib/reconciliation/reconcile';
import { describeStorageError, type Repository } from '../../lib/storage/repository';

export type ImportInput = { kind: 'url'; url: string } | { kind: 'file'; file: File };

export type ImportProgress =
  | { phase: 'download'; bytes: number; total?: number }
  | { phase: 'parse'; fraction: number }
  | { phase: 'save' };

export type ImportOutcome = {
  source: Source;
  channels: Channel[];
  playlist: PersonalPlaylist;
  stats: ReconcileStats;
  total: number;
  warnings: ParseWarning[];
  warningCounts: Partial<Record<WarningCode, number>>;
};

export type ImportArgs = {
  input: ImportInput;
  source?: Source;
  channels: Channel[];
  playlist: PersonalPlaylist;
  repo: Repository;
  signal?: AbortSignal;
  onProgress: (p: ImportProgress) => void;
  /** Asked when the refresh looks incomplete; returning false keeps existing data. */
  confirmSuspicious: (message: string) => Promise<boolean>;
};

function sourceName(input: ImportInput): string {
  if (input.kind === 'file') return input.file.name.slice(0, 100) || 'Playlist file';
  try {
    return new URL(input.url).hostname;
  } catch {
    return 'Playlist';
  }
}

/**
 * Fetch → parse → validate → reconcile → commit. Nothing is written until the
 * candidate catalogue has been parsed and validated, so a failed or cancelled
 * import leaves the existing catalogue and My Channels untouched.
 */
export async function runImport(args: ImportArgs): Promise<ImportOutcome> {
  const { input, signal, onProgress } = args;
  let text: string;
  if (input.kind === 'url') {
    text = await fetchPlaylistText(input.url, (bytes, total) => onProgress({ phase: 'download', bytes, total }), signal);
  } else {
    onProgress({ phase: 'download', bytes: 0, total: input.file.size });
    text = await readPlaylistFile(input.file);
  }

  onProgress({ phase: 'parse', fraction: 0 });
  const parsed: ParseResult = await parsePlaylist(
    text,
    { baseUrl: input.kind === 'url' ? input.url : undefined },
    (fraction) => onProgress({ phase: 'parse', fraction }),
    signal,
  );
  text = '';
  if (parsed.kind !== 'catalogue') throw new ImportError(describeKind(parsed.kind));

  const sourceId = args.source?.id ?? newId('src');
  const existing = args.channels.filter((c) => c.sourceId === sourceId);
  const saved = new Set(args.playlist.channelIds);
  const result = reconcile(existing, parsed.entries, saved, sourceId, () => newId('ch'));
  if (result.suspicious && !(await args.confirmSuspicious(result.suspicious))) {
    throw new ImportError('Import cancelled. Your existing channels were kept.');
  }
  if (signal?.aborted) throw new ImportError('Import cancelled. Your existing channels were kept.');

  const source: Source = {
    id: sourceId,
    name: sourceName(input),
    kind: input.kind,
    lastSuccessfulRefreshAt: new Date().toISOString(),
  };
  if (input.kind === 'url') source.url = input.url;
  else source.fileName = input.file.name.slice(0, 200);

  const valid = new Set(result.channels.map((c) => c.id));
  const playlist: PersonalPlaylist = { ...args.playlist, channelIds: args.playlist.channelIds.filter((id) => valid.has(id)) };

  onProgress({ phase: 'save' });
  try {
    await args.repo.commitCatalogue({ source, channels: result.channels, deleteChannelIds: result.deletedIds, playlist });
  } catch (err) {
    throw new ImportError(describeStorageError(err), 'Your previous channels were not changed.');
  }
  return {
    source,
    channels: result.channels,
    playlist,
    stats: result.stats,
    total: parsed.entries.length,
    warnings: parsed.warnings,
    warningCounts: parsed.warningCounts,
  };
}
