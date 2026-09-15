import { useAuth } from '@clerk/react';
import { useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { userApi } from '@/lib/api/user';

const profileQueryRoot = ['profile'] as const;

export function profileQueryKey(userId: string) {
  return [...profileQueryRoot, userId] as const;
}

export function ProfileBootstrap() {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);
  const activeUserId = isLoaded && isSignedIn ? userId : null;
  const writing = useIsMutating({ mutationKey: profileQueryKey(activeUserId ?? '') }) > 0;

  useEffect(() => {
    if (!isLoaded) return;

    const previous = previousUserId.current;
    if (!activeUserId) {
      void queryClient.cancelQueries({ queryKey: profileQueryRoot });
      queryClient.removeQueries({ queryKey: profileQueryRoot });
    } else if (previous && previous !== activeUserId) {
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
    refetchInterval: (query) => {
      if (writing) return false;
      const status = query.state.data?.pictureImportStatus;
      return status === 'pending' || status === 'retrying' ? 5000 : false;
    },
  });

  return null;
}
