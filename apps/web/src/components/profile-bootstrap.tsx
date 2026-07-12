import { useAuth } from '@clerk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef } from 'react';
import { useAuthTokenReady } from '@/components/auth-bridge';
import { userApi, UserApiError, type Profile } from '@/lib/api/user';

const profileQueryRoot = ['profile'] as const;
const ProfileContext = createContext<Profile | undefined>(undefined);

export function useProfile() {
  return useContext(ProfileContext);
}

export function profileQueryKey(userId: string) {
  return [...profileQueryRoot, userId] as const;
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const isTokenReady = useAuthTokenReady();
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
      void queryClient.cancelQueries({ queryKey: profileQueryKey(previous) });
      queryClient.removeQueries({ queryKey: profileQueryKey(previous) });
    }
    previousUserId.current = activeUserId;
  }, [activeUserId, isLoaded, queryClient]);

  const query = useQuery({
    queryKey: profileQueryKey(activeUserId ?? ''),
    queryFn: ({ signal }) =>
      userApi.ensureProfile({
        signal,
        expectedProfileId: activeUserId ?? undefined,
        tokenProvider: getToken,
      }),
    enabled: Boolean(activeUserId) && isTokenReady,
    staleTime: Infinity,
    retry: (failureCount, error) => {
      if (error instanceof UserApiError && error.status < 500) return false;
      return failureCount < 2;
    },
  });

  return <ProfileContext.Provider value={activeUserId ? query.data : undefined}>{children}</ProfileContext.Provider>;
}

export function ProfileBootstrap() {
  return <ProfileProvider>{null}</ProfileProvider>;
}
