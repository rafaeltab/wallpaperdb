import { canonicalProfileOutcome } from '../index';
import { GatewayAdmissionError } from '@/features/request-admission/adapters/graphql';
import type { QueryClient } from '@tanstack/react-query';
import { notFound, redirect } from '@tanstack/react-router';
import type { Profile } from '@/lib/graphql/types';
import { profileByHandleQueryOptions, profileByIdQueryOptions } from '@/lib/profile-query-options';

export async function loadCanonicalProfile(
  queryClient: QueryClient,
  handle: string
): Promise<Profile> {
  const options = profileByHandleQueryOptions(handle);
  const resolution = await queryClient.fetchQuery(options).catch((error: unknown) => {
    const cached = queryClient.getQueryData(options.queryKey);
    if (error instanceof GatewayAdmissionError && cached) return cached;
    throw error;
  });
  const outcome = canonicalProfileOutcome(resolution, handle);
  if (outcome.kind === 'missing') throw notFound();
  if (outcome.kind === 'redirect') throw redirectToCanonicalProfile(outcome.handle);
  return outcome.profile;
}

export async function redirectHandleToCanonical(
  queryClient: QueryClient,
  handle: string
): Promise<never> {
  const resolution = await queryClient.fetchQuery(profileByHandleQueryOptions(handle));
  const outcome = canonicalProfileOutcome(resolution);
  if (outcome.kind === 'missing') throw notFound();
  if (outcome.kind === 'redirect') throw redirectToCanonicalProfile(outcome.handle);
  throw notFound();
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
    to: '/profiles/@{$handle}',
    params: { handle },
    replace: true,
  });
}
