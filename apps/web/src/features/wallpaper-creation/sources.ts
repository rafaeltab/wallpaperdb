import type { WallpaperStatus } from './contract';
export interface ManagedCandidate {
  readonly candidateId: string;
  readonly expectedSourceSetRevision: string;
  readonly status: string;
  readonly sourceId?: string;
  readonly reason?: string;
}
export interface OwnedSources {
  readonly sourceSetRevision: string;
  readonly sources: readonly {
    readonly sourceId: string;
    readonly facts?: { readonly width: number; readonly height: number };
  }[];
  readonly candidates: readonly ManagedCandidate[];
}
export interface SourceBatchApi<TFile> {
  readonly begin: (key: string, signal: AbortSignal) => Promise<WallpaperStatus>;
  readonly wallpaper: (id: string, signal: AbortSignal) => Promise<WallpaperStatus>;
  readonly list: (asset: string, signal: AbortSignal) => Promise<OwnedSources>;
  readonly create: (
    asset: string,
    key: string,
    revision: string,
    signal: AbortSignal
  ) => Promise<ManagedCandidate>;
  readonly status: (asset: string, id: string, signal: AbortSignal) => Promise<ManagedCandidate>;
  readonly upload: (
    asset: string,
    id: string,
    file: TFile,
    signal: AbortSignal
  ) => Promise<ManagedCandidate>;
  readonly expectSource: (
    wallpaper: string,
    candidate: string,
    intent: string,
    signal: AbortSignal
  ) => Promise<void>;
  readonly accept: (
    asset: string,
    id: string,
    revision: string,
    correlation: string,
    signal: AbortSignal
  ) => Promise<ManagedCandidate>;
  readonly cancel: (asset: string, id: string, signal: AbortSignal) => Promise<void>;
  readonly wait: (signal: AbortSignal) => Promise<void>;
}
export class SourceIntakeError extends Error {
  constructor(
    message: string,
    readonly restartCandidate = false
  ) {
    super(message);
  }
}
interface Receipt {
  readonly key: string;
  readonly revision: string;
  readonly initial: boolean;
  candidate?: ManagedCandidate;
}
export interface SourceUploadRow<TFile> {
  readonly id: string;
  readonly name: string;
  readonly value: TFile;
  readonly status: 'pending' | 'uploading' | 'accepted' | 'failed' | 'confirming';
  readonly sourceId?: string;
  readonly message?: string;
  readonly receipt?: Receipt;
  readonly restart?: boolean;
}
/** One batch owns its files, captured candidate intents and originating UI lifetime.
 * The Asset service owns membership. A failed initial candidate may be superseded
 * only after a definitive rejection/cancellation; ambiguous acceptance pauses intake. */
export function createWallpaperSourceBatch<TFile>(
  api: SourceBatchApi<TFile>,
  target: { readonly creationKey: string } | { readonly wallpaperId: string }
) {
  let wallpaper: WallpaperStatus | undefined;
  let rows: readonly SourceUploadRow<TFile>[] = [];
  let busy = false;
  let current: {
    readonly rows: typeof rows;
    readonly busy: boolean;
    readonly wallpaperId?: string;
  } = { rows, busy };
  const listeners = new Set<() => void>();
  const publish = () => {
    current = { rows, busy, ...(wallpaper ? { wallpaperId: wallpaper.wallpaperId } : {}) };
    for (const listener of listeners) listener();
  };
  const update = (id: string, change: Partial<SourceUploadRow<TFile>>) => {
    rows = rows.map((row) => (row.id === id ? { ...row, ...change } : row));
    publish();
  };
  let running: Promise<void> | undefined;
  const batch = {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    addFiles(files: readonly { readonly value: TFile; readonly name: string }[]) {
      if (busy) return;
      rows = [
        ...rows,
        ...files
          .slice(0, Math.max(0, 16 - rows.length))
          .map((file) => ({ ...file, id: crypto.randomUUID(), status: 'pending' as const })),
      ];
      publish();
    },
    retry(id: string) {
      if (busy) return;
      const row = rows.find((row) => row.id === id);
      if (row && (row.status === 'failed' || row.status === 'confirming'))
        update(id, { status: 'pending', message: undefined });
    },
    run(signal = new AbortController().signal): Promise<void> {
      if (running) return running;
      busy = true;
      publish();
      running = (async () => {
        try {
          wallpaper =
            'creationKey' in target
              ? await api.begin(target.creationKey, signal)
              : await api.wallpaper(target.wallpaperId, signal);
          publish();
          for (let i = 0; i < 30 && !wallpaper.assetId && wallpaper.state !== 'failed'; i++) {
            await api.wait(signal);
            wallpaper = await api.wallpaper(wallpaper.wallpaperId, signal);
          }
          const asset = wallpaper.assetId;
          if (!asset || wallpaper.state === 'failed')
            throw new Error('Wallpaper is waiting for its Asset. Retry this saved request.');
          for (const row of rows) {
            if (row.status !== 'pending') continue;
            signal.throwIfAborted();
            update(row.id, { status: 'uploading' });
            let receipt = row.receipt;
            let definitiveFailure = false;
            try {
              if (row.restart && receipt?.candidate)
                await api.cancel(asset, receipt.candidate.candidateId, signal);
              if (!receipt || row.restart) {
                const saved = await api.list(asset, signal);
                receipt = {
                  key: crypto.randomUUID(),
                  revision: saved.sourceSetRevision,
                  initial: saved.sources.length === 0,
                };
                update(row.id, { receipt, restart: false });
              }
              let candidate = receipt.candidate
                ? await api.status(asset, receipt.candidate.candidateId, signal)
                : await api.create(asset, receipt.key, receipt.revision, signal);
              receipt.candidate = candidate;
              const waitForInspection = async () => {
                for (
                  let i = 0;
                  i < 30 && ['inspecting', 'accepting'].includes(candidate.status);
                  i++
                ) {
                  await api.wait(signal);
                  candidate = await api.status(asset, candidate.candidateId, signal);
                  receipt.candidate = candidate;
                }
              };
              await waitForInspection();
              if (candidate.status === 'awaiting-bytes') {
                candidate = await api.upload(asset, candidate.candidateId, row.value, signal);
                receipt.candidate = candidate;
                await waitForInspection();
              }
              if (['rejected', 'cancelled'].includes(candidate.status)) {
                definitiveFailure = true;
                update(row.id, {
                  status: 'failed',
                  restart: true,
                  message: candidate.reason ?? 'Source rejected. Retry this file independently.',
                });
                continue;
              }
              if (candidate.status === 'ready') {
                if (receipt.initial) {
                  // Do not replace an in-flight initial intent after another tab won acceptance.
                  const saved = await api.list(asset, signal);
                  if (saved.sourceSetRevision !== receipt.revision)
                    throw new SourceIntakeError(
                      'Sources changed. Retry this file against the current set.',
                      true
                    );
                  await api.expectSource(
                    wallpaper.wallpaperId,
                    candidate.candidateId,
                    candidate.candidateId,
                    signal
                  );
                }
                candidate = await api.accept(
                  asset,
                  candidate.candidateId,
                  receipt.revision,
                  candidate.candidateId,
                  signal
                );
                receipt.candidate = candidate;
              }
              if (candidate.status === 'rejected' || candidate.status === 'cancelled') {
                definitiveFailure = true;
                update(row.id, {
                  status: 'failed',
                  restart: true,
                  message: candidate.reason ?? 'Source rejected. Retry this file independently.',
                });
                continue;
              }
              if (candidate.status !== 'accepted') {
                update(row.id, {
                  status: 'confirming',
                  message: 'Progress is saved. Check again to resume this file.',
                });
                if (receipt.initial) break;
                continue;
              }
              update(row.id, {
                status: 'accepted',
                sourceId: candidate.sourceId,
                message: undefined,
              });
              if (receipt.initial) {
                for (let i = 0; i < 30 && wallpaper.state !== 'published'; i++) {
                  await api.wait(signal);
                  wallpaper = await api.wallpaper(wallpaper.wallpaperId, signal);
                }
                if (wallpaper.state !== 'published') break;
              }
            } catch (error) {
              const restart = error instanceof SourceIntakeError && error.restartCandidate;
              update(row.id, {
                status: signal.aborted ? 'confirming' : 'failed',
                restart,
                message: signal.aborted
                  ? 'Upload interrupted. Reselect the same file after refresh or retry here.'
                  : error instanceof Error
                    ? error.message
                    : 'Source progress is saved. Retry this file.',
              });
              if (signal.aborted || (receipt?.initial && !definitiveFailure)) break;
            }
          }
        } catch (error) {
          for (const row of rows)
            if (row.status === 'pending')
              update(row.id, {
                status: 'failed',
                message:
                  error instanceof Error ? error.message : 'Creation is saved. Retry this request.',
              });
        } finally {
          busy = false;
          running = undefined;
          publish();
        }
      })();
      return running;
    },
  };
  return batch;
}
