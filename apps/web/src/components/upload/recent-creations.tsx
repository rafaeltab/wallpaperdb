import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { recentCreations, downloadOriginal } from '@/features/wallpaper-creation/adapters/http';
import { resumeWallpaperWithDetails } from '@/lib/api/wallpaper';
const labels = {
  'creating-asset': 'Waiting for Asset creation',
  'awaiting-source': 'Asset ready. Retry the same file to upload its first Source.',
  'accepting-source': 'Waiting for Source acceptance confirmation',
  published: 'Wallpaper created',
  failed: 'Creation could not complete. Operator attention may be required.',
};
export function RecentCreations() {
  const { userId, isSignedIn } = useAuth();
  return (
    <RecentCreationsForOwner
      key={userId ?? 'signed-out'}
      userId={userId}
      isSignedIn={!!isSignedIn}
    />
  );
}

function RecentCreationsForOwner({
  userId,
  isSignedIn,
}: {
  userId: string | null | undefined;
  isSignedIn: boolean;
}) {
  const active = useRef(new Set<AbortController>());
  useEffect(() => {
    if (!userId) return;
    return () => {
      for (const c of active.current) c.abort();
      active.current.clear();
    };
  }, [userId]);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(new Set<string>());
  const [resuming, setResuming] = useState<ReadonlySet<string>>(new Set());
  const query = useQuery({
    queryKey: ['wallpaper-creations', userId],
    enabled: !!isSignedIn,
    queryFn: ({ signal }) => recentCreations(signal),
    refetchInterval: 2000,
  });
  return (
    <section
      aria-label="Recent Wallpaper creations"
      className="space-y-3"
      data-testid="recent-creations"
    >
      <h2 className="font-semibold">Recent creations</h2>
      <p className="text-sm text-muted-foreground">
        Progress is saved by Wallpaper and remains available after a refresh. Accepted Sources can
        be downloaded by their owner.
      </p>
      {query.isPending && <p>Loading creation progress…</p>}
      {query.isError && (
        <p role="alert">
          Creation progress is temporarily unavailable. Refresh to check your saved requests.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {query.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">No creations yet.</p>
      )}
      <ul className="space-y-3">
        {query.data?.map((w) => (
          <li
            key={w.wallpaperId}
            className="rounded-lg border p-3 space-y-2"
            data-testid="wallpaper-creation"
          >
            <p className="font-medium">
              {w.candidateStatus === 'rejected'
                ? 'Source upload was rejected. Select the file again to start a new creation.'
                : w.candidateStatus === 'cancelled'
                  ? 'Source upload was cancelled.'
                  : w.candidateStatus === 'unavailable'
                    ? 'Source progress is temporarily unavailable.'
                    : w.attentionRequired
                      ? 'Progress requires operator attention. Your accepted request is retained.'
                      : labels[w.state]}
            </p>
            <p className="text-xs break-all text-muted-foreground">{w.wallpaperId}</p>
            {w.state !== 'published' &&
              w.state !== 'failed' &&
              w.candidateStatus !== 'rejected' &&
              w.candidateStatus !== 'cancelled' && (
                <label className="block text-sm">
                  Resume this creation with its image
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={resuming.has(w.wallpaperId)}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (!file || busy.current.has(w.wallpaperId)) return;
                      busy.current.add(w.wallpaperId);
                      setResuming(new Set(busy.current));
                      setError(null);
                      const controller = new AbortController();
                      active.current.add(controller);
                      void resumeWallpaperWithDetails(file, w.wallpaperId, controller.signal)
                        .then((result) => {
                          if (!controller.signal.aborted && !result.success && !result.pending)
                            setError(result.error?.message ?? 'Creation could not be resumed.');
                          if (!controller.signal.aborted) void query.refetch();
                        })
                        .finally(() => {
                          active.current.delete(controller);
                          busy.current.delete(w.wallpaperId);
                          if (!controller.signal.aborted) setResuming(new Set(busy.current));
                        });
                    }}
                  />
                </label>
              )}
            {w.state === 'published' && w.sourceId && (
              <button
                type="button"
                className="text-sm underline"
                onClick={() => {
                  setError(null);
                  const controller = new AbortController();
                  active.current.add(controller);
                  void downloadOriginal(w, controller.signal)
                    .catch(() => {
                      if (!controller.signal.aborted)
                        setError(
                          'The accepted Source is temporarily unavailable. Retry the download.'
                        );
                    })
                    .finally(() => active.current.delete(controller));
                }}
              >
                Download accepted Source
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
