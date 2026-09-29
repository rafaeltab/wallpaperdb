import { useQueryClient } from '@tanstack/react-query';
import { type ErrorComponentProps, useParams, useRouter } from '@tanstack/react-router';
import { useCallback, useSyncExternalStore } from 'react';
import { GraphQLError } from '@/components/graphql-error';

export function ProfileRouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <GraphQLError
        error={error}
        retry={() => router.invalidate()}
        title="Could not load Profile"
      />
    </div>
  );
}

// Observe the loader's existing request without starting another fetch or changing its retry budget.
export function ProfileQueryStatus({ pending = false }: { pending?: boolean }) {
  const client = useQueryClient();
  const router = useRouter();
  const { handle, profileId } = useParams({ strict: false });
  const subscribe = useCallback(
    (notify: () => void) => client.getQueryCache().subscribe(notify),
    [client]
  );
  const snapshot = useCallback(
    () =>
      client.getQueryState(['public-profile', profileId ? 'id' : 'handle', profileId ?? handle]),
    [client, profileId, handle]
  );
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const error = state?.fetchFailureReason ?? state?.error;
  if (!error) return pending ? <output>Loading Profile…</output> : null;
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <GraphQLError
        error={error}
        retry={() => router.invalidate()}
        retrying={state?.fetchStatus === 'fetching'}
        title="Could not refresh Profile"
      />
    </div>
  );
}

export function ProfileRoutePending() {
  return <ProfileQueryStatus pending />;
}
