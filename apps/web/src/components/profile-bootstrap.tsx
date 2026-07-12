import { useAuth } from '@clerk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  });

  return null;
}
