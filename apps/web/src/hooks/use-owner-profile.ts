import { QueryClientContext } from '@tanstack/react-query';
import { useCallback, useContext, useSyncExternalStore } from 'react';
import { profileQueryKey } from '@/components/profile-bootstrap';
import type { Profile } from '@/lib/api/user';

/** Observe the owner cache without changing the ensure query's fetch options. */
export function useOwnerProfile(profileId: string) {
  const client = useContext(QueryClientContext);
  const subscribe = useCallback(
    (onChange: () => void) => client?.getQueryCache().subscribe(onChange) ?? (() => {}),
    [client]
  );
  const snapshot = useCallback(() => {
    const state = client?.getQueryState<Profile>(profileQueryKey(profileId));
    // Query creation can happen during another component's render. An empty query
    // does not change the owner data this subscriber exposes.
    return state?.data === undefined ? undefined : state;
  }, [client, profileId]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { profile: state?.data, refreshedAt: state?.dataUpdatedAt ?? 0 };
}
