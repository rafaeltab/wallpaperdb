import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createWallpaperSourceBatch, type ManagedCandidate } from '@/features/wallpaper-creation';
import {
  browserSourceBatchApi,
  ownedSources,
  downloadSourceOriginal,
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
  const { userId } = useAuth();
  const saved = useQuery({
    queryKey: ['wallpaper-sources', userId, currentAsset],
    enabled: !!currentAsset,
    queryFn: ({ signal }) =>
      currentAsset
        ? ownedSources(currentAsset, signal)
        : Promise.reject(new Error('Asset pending')),
    refetchInterval: 2000,
  });
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    const controller = new AbortController();
    active.current.add(controller);
    void batch.run(controller.signal).finally(() => {
      active.current.delete(controller);
      if (!controller.signal.aborted) void saved.refetch();
    });
  };
  const select = (files: FileList | null, candidate?: ManagedCandidate) => {
    if (!files?.length) return;
    const file = files[0];
    const added =
      candidate && file
        ? batch.resume({ value: file, name: file.name }, candidate)
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
          disabled={snapshot.busy || snapshot.rows.length >= 16}
          onChange={(event) => {
            select(event.target.files);
            event.target.value = '';
          }}
        />
      </label>
      {snapshot.busy && <output>Saving Source progress…</output>}
      {snapshot.canResume && (
        <button type="button" className="underline text-sm" onClick={run}>
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
            {row.message && <p>{row.message}</p>}
            {(row.status === 'failed' || row.status === 'confirming') && (
              <button
                type="button"
                disabled={snapshot.busy}
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
      {saved.data && (
        <>
          <p className="text-sm">
            {saved.data.sources.length} accepted Sources. Source revision{' '}
            {saved.data.sourceSetRevision}.
          </p>
          <ul className="space-y-2">
            {saved.data.sources.map((source) => (
              <li key={source.sourceId} className="text-xs break-all">
                {source.sourceId}
                {source.facts && ` · ${source.facts.width} × ${source.facts.height}`}{' '}
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
                    Retry or resume this Source with its image
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={snapshot.busy}
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
