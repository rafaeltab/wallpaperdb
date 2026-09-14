import type { QueryClient } from '@tanstack/react-query';
import { notFound, redirect } from '@tanstack/react-router';
import type { Profile } from '@/lib/graphql/types';
import { profileByHandleQueryOptions, profileByIdQueryOptions } from '@/lib/profile-query-options';

export async function loadCanonicalProfile(
  queryClient: QueryClient,
  handle: string
): Promise<Profile> {
  const resolution = await queryClient.fetchQuery(profileByHandleQueryOptions(handle));
  if (!resolution) throw notFound();

  if (resolution.canonicalHandle !== handle) {
    throw redirectToCanonicalProfile(resolution.canonicalHandle);
  }

  return resolution.profile;
}

export async function redirectHandleToCanonical(
  queryClient: QueryClient,
  handle: string
): Promise<never> {
  const resolution = await queryClient.fetchQuery(profileByHandleQueryOptions(handle));
  if (!resolution) throw notFound();
  throw redirectToCanonicalProfile(resolution.canonicalHandle);
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
