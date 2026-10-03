import {
  ProfileRouteError,
  ProfileRoutePending,
  ProfileQueryStatus,
} from '@/components/profile/profile-route-state';
import { createFileRoute } from '@tanstack/react-router';
import { ProfileNotFoundPage } from '@/components/profile/profile-not-found-page';
import { PublicProfilePage } from '@/components/profile/public-profile-page';
import { loadCanonicalProfile } from '@/features/public-profile/adapters/routes';

export const Route = createFileRoute('/profiles/@{$handle}')({
  loader: ({ context, params }) => loadCanonicalProfile(context.queryClient, params.handle),
  component: CanonicalProfileRoute,
  notFoundComponent: ProfileNotFoundPage,
  errorComponent: ProfileRouteError,
  pendingComponent: ProfileRoutePending,
  pendingMs: 0,
});

function CanonicalProfileRoute() {
  const profile = Route.useLoaderData();
  return (
    <>
      <ProfileQueryStatus />
      <PublicProfilePage profile={profile} />
    </>
  );
}
