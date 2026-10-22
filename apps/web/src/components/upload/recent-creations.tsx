import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { recentCreations, downloadOriginal } from '@/features/wallpaper-creation/adapters/http';
const labels = {
  'creating-asset': 'Waiting for Asset creation',
  'awaiting-source': 'Asset ready. Retry the same file to upload its first Source.',
  'accepting-source': 'Waiting for Source acceptance confirmation',
  published: 'Wallpaper created',
  failed: 'Creation could not complete. Operator attention may be required.',
};
export function RecentCreations() {
  const { userId, isSignedIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
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
        be downloaded by their owner. Public discovery is a separate workflow.
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
            <p className="font-medium">{labels[w.state]}</p>
            <p className="text-xs break-all text-muted-foreground">{w.wallpaperId}</p>
            {w.state === 'published' && w.sourceId && (
              <button
                type="button"
                className="text-sm underline"
                onClick={() => {
                  setError(null);
                  void downloadOriginal(w).catch(() =>
                    setError('The accepted Source is temporarily unavailable. Retry the download.')
                  );
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
