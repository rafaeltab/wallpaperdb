import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createWallpaperSourceBatch, type ManagedCandidate } from '@/features/wallpaper-creation';
import {
  browserSourceBatchApi,
  downloadSourceOriginal,
  ownedSources,
  selectSourceDefault,
  withdrawSource,
} from '@/features/wallpaper-creation/adapters/http';

export function WallpaperSources({
  wallpaperId,
  assetId,
}: {
  wallpaperId?: string;
  assetId?: string;
}) {
  const { userId } = useAuth();
  return (
    <SourceBatch
      key={`${userId}:${wallpaperId ?? 'new'}`}
      wallpaperId={wallpaperId}
      assetId={assetId}
    />
  );
}
function SourceBatch({ wallpaperId, assetId }: { wallpaperId?: string; assetId?: string }) {
  const [batch] = useState(() =>
    createWallpaperSourceBatch(
      browserSourceBatchApi(),
      wallpaperId ? { wallpaperId } : { creationKey: crypto.randomUUID() }
    )
  );
  const snapshot = useSyncExternalStore(batch.subscribe, batch.getSnapshot, batch.getSnapshot);
  const active = useRef(new Set<AbortController>());
  useEffect(
    () => () => {
      for (const controller of active.current) controller.abort();
      active.current.clear();
    },
    []
  );
  const currentAsset = assetId ?? snapshot.assetId;
  const [candidateCursor, setCandidateCursor] = useState<string>();
  const { userId } = useAuth();
  const saved = useQuery({
    queryKey: ['wallpaper-sources', userId, currentAsset, candidateCursor],
    enabled: !!currentAsset,
    queryFn: ({ signal }) =>
      currentAsset
        ? ownedSources(currentAsset, signal, candidateCursor)
        : Promise.reject(new Error('Asset pending')),
    refetchInterval: 2000,
  });
  const [error, setError] = useState<string | null>(null);
  const management = useRef(false);
  const [managing, setManaging] = useState(false);
  const changeSource = async (operation: 'select-default' | 'withdraw', sourceId: string) => {
    if (management.current || batch.getSnapshot().busy || !currentAsset || !saved.data) return;
    management.current = true;
    setManaging(true);
    setError(null);
    const controller = new AbortController();
    active.current.add(controller);
    const revision = saved.data.sourceSetRevision;
    try {
      const change = operation === 'select-default' ? selectSourceDefault : withdrawSource;
      await change(currentAsset, sourceId, revision, controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Source change unavailable. Review Sources and try again.'
        );
    } finally {
      if (!controller.signal.aborted) await saved.refetch();
      active.current.delete(controller);
      if (!controller.signal.aborted) setManaging(false);
      management.current = false;
    }
  };
  const run = () => {
    if (management.current) return;
    const controller = new AbortController();
    active.current.add(controller);
    void batch.run(controller.signal).finally(() => {
      active.current.delete(controller);
      if (!controller.signal.aborted) void saved.refetch();
    });
  };
  const select = (
    files: FileList | null,
    candidate?: ManagedCandidate,
    targetSourceId?: string
  ) => {
    if (management.current) return;
    if (!files?.length) return;
    const file = files[0];
    const added =
      candidate && file
        ? batch.resume({ value: file, name: file.name }, candidate)
        : targetSourceId && file
          ? batch.replace({ value: file, name: file.name }, targetSourceId)
          : batch.addFiles(Array.from(files).map((file) => ({ value: file, name: file.name })));
    if (!added) {
      setError('Select at most 16 files per upload batch.');
      return;
    }
    setError(null);
    run();
  };
  return (
    <section
      aria-label={wallpaperId ? 'Wallpaper Sources' : 'Create one Wallpaper with multiple Sources'}
      className="space-y-3 rounded border p-3"
      data-testid="wallpaper-sources"
    >
      <h3 className="font-semibold">
        {wallpaperId ? 'Wallpaper Sources' : 'Create one Wallpaper with multiple Sources'}
      </h3>
      <p className="text-sm text-muted-foreground">
        Select images of the same shape for one Wallpaper. Each Source has its own outcome and
        retry. Technical admission does not compare image content.
      </p>
      {snapshot.wallpaperId && !wallpaperId && (
        <p className="text-xs break-all">Saved Wallpaper: {snapshot.wallpaperId}</p>
      )}
      <label className="block text-sm">
        {wallpaperId ? 'Add Sources to this Wallpaper' : 'Choose initial Sources for one Wallpaper'}
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={snapshot.busy || managing || snapshot.remainingCapacity === 0}
          onChange={(event) => {
            select(event.target.files);
            event.target.value = '';
          }}
        />
      </label>
      {snapshot.busy && <output>Saving Source progress…</output>}
      {managing && <output>Saving Source change…</output>}
      {snapshot.canResume && (
        <button type="button" className="underline text-sm" onClick={run} disabled={managing}>
          Resume remaining Sources
        </button>
      )}
      <ul className="space-y-2">
        {snapshot.rows.map((row) => (
          <li key={row.id} data-testid="source-upload-outcome" className="text-sm">
            <span className="font-medium">{row.name}</span>:{' '}
            {row.status === 'accepted'
              ? 'Source accepted'
              : row.status === 'failed'
                ? 'Source failed'
                : row.status === 'confirming'
                  ? 'Awaiting confirmation'
                  : row.status === 'uploading'
                    ? 'Uploading Source'
                    : 'Waiting to upload'}
            {row.targetSourceId && (
              <p>
                Replacing Source {row.targetSourceId}. Its accepted image stays active until
                replacement succeeds.
              </p>
            )}
            {row.message && <p>{row.message}</p>}
            {(row.status === 'failed' || row.status === 'confirming') && (
              <button
                type="button"
                disabled={
                  snapshot.busy ||
                  managing ||
                  (row.status === 'failed' && snapshot.remainingCapacity === 0)
                }
                className="underline"
                onClick={() => {
                  batch.retry(row.id);
                  run();
                }}
              >
                Retry {row.name}
              </button>
            )}
          </li>
        ))}
      </ul>
      {currentAsset && saved.isPending && <p>Loading accepted Sources…</p>}
      {currentAsset && saved.isError && (
        <p role="alert">
          Source progress is temporarily unavailable. Accepted Sources remain saved.
        </p>
      )}
      {candidateCursor !== undefined && (
        <button
          type="button"
          className="underline text-sm"
          disabled={saved.isFetching}
          onClick={() => setCandidateCursor(undefined)}
        >
          Latest Source outcomes
        </button>
      )}
      {saved.data && (
        <>
          <p className="text-sm">
            {saved.data.sources.length} accepted Sources. Source revision{' '}
            {saved.data.sourceSetRevision}.
          </p>
          <p className="text-sm text-muted-foreground">
            Change Default before withdrawing its Source.
          </p>
          {saved.data.nextCandidateCursor && (
            <button
              type="button"
              className="underline text-sm"
              disabled={saved.isFetching}
              onClick={() => setCandidateCursor(saved.data?.nextCandidateCursor)}
            >
              Older Source outcomes
            </button>
          )}
          <ul className="space-y-2">
            {saved.data.sources.map((source) => (
              <li key={source.sourceId} className="text-xs break-all">
                {source.sourceId}
                {source.sourceId === saved.data.defaultSourceId && ' · Default Source'}
                {source.facts && ` · ${source.facts.width} × ${source.facts.height}`}{' '}
                {source.sourceId !== saved.data.defaultSourceId && (
                  <button
                    type="button"
                    className="underline"
                    disabled={snapshot.busy || managing}
                    aria-label={`Make Default Source ${source.sourceId}`}
                    onClick={() => void changeSource('select-default', source.sourceId)}
                  >
                    Make Default
                  </button>
                )}{' '}
                <button
                  type="button"
                  className="underline"
                  aria-label={`Withdraw Source ${source.sourceId}`}
                  disabled={
                    snapshot.busy ||
                    managing ||
                    saved.data.sources.length <= 1 ||
                    source.sourceId === saved.data.defaultSourceId
                  }
                  onClick={() => void changeSource('withdraw', source.sourceId)}
                >
                  Withdraw Source
                </button>{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    if (!currentAsset) return;
                    const controller = new AbortController();
                    active.current.add(controller);
                    setError(null);
                    void downloadSourceOriginal(currentAsset, source.sourceId, controller.signal)
                      .catch(() => {
                        if (!controller.signal.aborted)
                          setError('Original unavailable. Retry the download.');
                      })
                      .finally(() => active.current.delete(controller));
                  }}
                >
                  Download original
                </button>
                <label className="block">
                  Replace Source {source.sourceId}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={snapshot.busy || managing || snapshot.remainingCapacity === 0}
                    onChange={(event) => {
                      select(event.target.files, undefined, source.sourceId);
                      event.target.value = '';
                    }}
                  />
                </label>
              </li>
            ))}
          </ul>
          <ul className="space-y-2">
            {saved.data.candidates
              .filter(
                (candidate) =>
                  candidate.status !== 'accepted' &&
                  !snapshot.rows.some(
                    (row) => row.receipt?.candidate?.candidateId === candidate.candidateId
                  )
              )
              .map((candidate) => (
                <li key={candidate.candidateId} className="text-xs break-all">
                  Saved Source {candidate.candidateId}: {candidate.status}
                  {candidate.reason && ` · ${candidate.reason}`}
                  <label className="block">
                    {candidate.operation === 'replace-one'
                      ? `Retry or resume replacement for ${candidate.targetSourceId}`
                      : 'Retry or resume this Source with its image'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={snapshot.busy || managing || snapshot.remainingCapacity === 0}
                      onChange={(event) => {
                        select(event.target.files, candidate);
                        event.target.value = '';
                      }}
                    />
                  </label>
                </li>
              ))}
          </ul>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
