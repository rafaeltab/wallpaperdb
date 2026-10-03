import { pictureImportPollInterval, shouldClearOwnerProfile } from '@/features/profile-management';
import { useAuth } from '@clerk/react';
import { useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { userApi } from '@/lib/api/user';

import {
  ownerProfileQueryRoot as profileQueryRoot,
  profileQueryKey,
} from '@/features/profile-management/adapters/query';
export { profileQueryKey } from '@/features/profile-management/adapters/query';

export function ProfileBootstrap() {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);
  const activeUserId = isLoaded && isSignedIn ? userId : null;
  const writing = useIsMutating({ mutationKey: profileQueryKey(activeUserId ?? '') }) > 0;

  useEffect(() => {
    if (!isLoaded) return;

    const previous = previousUserId.current;
    if (shouldClearOwnerProfile(previous, activeUserId, isLoaded)) {
      void queryClient.cancelQueries({ queryKey: profileQueryRoot });
      queryClient.removeQueries({ queryKey: profileQueryRoot });
    }
    previousUserId.current = activeUserId;
  }, [activeUserId, isLoaded, queryClient]);

  useQuery({
    queryKey: profileQueryKey(activeUserId ?? ''),
    queryFn: ({ signal }) =>
      userApi.ensureProfile({
        signal,
        expectedProfileId: activeUserId ?? undefined,
        tokenProvider: getToken,
      }),
    enabled: Boolean(activeUserId),
    staleTime: Infinity,
    refetchInterval: (query) =>
      pictureImportPollInterval(query.state.data?.pictureImportStatus, writing),
  });

  return null;
}
