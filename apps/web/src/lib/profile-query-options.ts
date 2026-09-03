import { queryOptions } from '@tanstack/react-query';
import { fetchProfileByHandle, fetchProfileById } from '@/lib/graphql/profiles';

export function profileByHandleQueryOptions(handle: string) {
  return queryOptions({
    queryKey: ['public-profile', 'handle', handle] as const,
    queryFn: () => fetchProfileByHandle(handle),
  });
}

export function profileByIdQueryOptions(profileId: string) {
  return queryOptions({
    queryKey: ['public-profile', 'id', profileId] as const,
    queryFn: () => fetchProfileById(profileId),
  });
}
