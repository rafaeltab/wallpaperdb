import { createFileRoute } from '@tanstack/react-router';
import { ProfileNotFoundPage } from '@/components/profile/profile-not-found-page';
import { PublicProfilePage } from '@/components/profile/public-profile-page';
import { loadCanonicalProfile } from '@/lib/profile-route-loaders';

export const Route = createFileRoute('/profiles/@{$handle}')({
  loader: ({ context, params }) => loadCanonicalProfile(context.queryClient, params.handle),
  component: CanonicalProfileRoute,
  notFoundComponent: ProfileNotFoundPage,
});

function CanonicalProfileRoute() {
  const profile = Route.useLoaderData();
  return <PublicProfilePage profile={profile} />;
}
