import type { QueryClient } from '@tanstack/react-query';
import { notFound, redirect } from '@tanstack/react-router';
import type { Profile } from '@/lib/graphql/types';
import { profileByHandleQueryOptions, profileByIdQueryOptions } from '@/lib/profile-query-options';

export async function loadCanonicalProfile(
  queryClient: QueryClient,
  handle: string
): Promise<Profile> {
  const profile = await queryClient.fetchQuery(profileByHandleQueryOptions(handle));
  if (!profile) throw notFound();

  if (profile.handle !== handle) {
    throw redirectToCanonicalProfile(profile.handle);
  }

  return profile;
}

export async function redirectHandleToCanonical(
  queryClient: QueryClient,
  handle: string
): Promise<never> {
  const profile = await queryClient.fetchQuery(profileByHandleQueryOptions(handle));
  if (!profile) throw notFound();
  throw redirectToCanonicalProfile(profile.handle);
}

export async function redirectProfileIdToCanonical(
  queryClient: QueryClient,
  profileId: string
): Promise<never> {
  const profile = await queryClient.fetchQuery(profileByIdQueryOptions(profileId));
  if (!profile) throw notFound();
  throw redirectToCanonicalProfile(profile.handle);
}

function redirectToCanonicalProfile(handle: string): Response {
  return redirect({
    href: `/profiles/@${handle}`,
    replace: true,
  });
}
