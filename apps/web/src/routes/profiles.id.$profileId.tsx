import { createFileRoute } from '@tanstack/react-router';
import { ProfileNotFoundPage } from '@/components/profile/profile-not-found-page';
import { redirectProfileIdToCanonical } from '@/lib/profile-route-loaders';

export const Route = createFileRoute('/profiles/id/$profileId')({
  loader: ({ context, params }) =>
    redirectProfileIdToCanonical(context.queryClient, params.profileId),
  notFoundComponent: ProfileNotFoundPage,
});
