import { ProfileRouteError, ProfileRoutePending } from '@/components/profile/profile-route-state';
import { createFileRoute } from '@tanstack/react-router';
import { ProfileNotFoundPage } from '@/components/profile/profile-not-found-page';
import { redirectProfileIdToCanonical } from '@/features/public-profile/adapters/routes';

export const Route = createFileRoute('/profiles/id/$profileId')({
  loader: ({ context, params }) =>
    redirectProfileIdToCanonical(context.queryClient, params.profileId),
  notFoundComponent: ProfileNotFoundPage,
  errorComponent: ProfileRouteError,
  pendingComponent: ProfileRoutePending,
  pendingMs: 0,
});
