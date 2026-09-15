import { request } from '@/lib/graphql/client';
import { GET_PROFILE, GET_PROFILE_BY_HANDLE, SEARCH_PROFILES } from '@/lib/graphql/queries';
import type { HandleResolution, Profile, ProfileConnection } from '@/lib/graphql/types';

interface GetProfileResponse {
  profile: Profile | null;
}

interface GetProfileByHandleResponse {
  profileByHandle: HandleResolution | null;
}

export async function fetchProfileById(profileId: string): Promise<Profile | null> {
  const data = await request<GetProfileResponse>(GET_PROFILE, { id: profileId });
  return data.profile;
}

export async function fetchProfileByHandle(handle: string): Promise<HandleResolution | null> {
  const data = await request<GetProfileByHandleResponse>(GET_PROFILE_BY_HANDLE, { handle });
  return data.profileByHandle;
}

export async function searchProfiles(
  query: string,
  after: string | null = null
): Promise<ProfileConnection> {
  const data = await request<{ searchProfiles: ProfileConnection }>(SEARCH_PROFILES, {
    query,
    first: 10,
    after,
  });
  return data.searchProfiles;
}
