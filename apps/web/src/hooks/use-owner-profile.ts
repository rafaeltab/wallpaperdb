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
  const snapshot = useCallback(
    () => client?.getQueryState<Profile>(profileQueryKey(profileId)),
    [client, profileId]
  );
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { profile: state?.data, refreshedAt: state?.dataUpdatedAt ?? 0 };
}
