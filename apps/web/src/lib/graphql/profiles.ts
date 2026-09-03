import { request } from '@/lib/graphql/client';
import { GET_PROFILE, GET_PROFILE_BY_HANDLE } from '@/lib/graphql/queries';
import type { Profile } from '@/lib/graphql/types';

interface GetProfileResponse {
  profile: Profile | null;
}

interface GetProfileByHandleResponse {
  profileByHandle: Profile | null;
}

export async function fetchProfileById(profileId: string): Promise<Profile | null> {
  const data = await request<GetProfileResponse>(GET_PROFILE, { id: profileId });
  return data.profile;
}

export async function fetchProfileByHandle(handle: string): Promise<Profile | null> {
  const data = await request<GetProfileByHandleResponse>(GET_PROFILE_BY_HANDLE, { handle });
  return data.profileByHandle;
}
