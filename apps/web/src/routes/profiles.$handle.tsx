import { ProfileRouteError, ProfileRoutePending } from '@/components/profile/profile-route-state';
import { createFileRoute } from '@tanstack/react-router';
import { ProfileNotFoundPage } from '@/components/profile/profile-not-found-page';
import { redirectHandleToCanonical } from '@/lib/profile-route-loaders';

export const Route = createFileRoute('/profiles/$handle')({
  loader: ({ context, params }) => redirectHandleToCanonical(context.queryClient, params.handle),
  notFoundComponent: ProfileNotFoundPage,
  errorComponent: ProfileRouteError,
  pendingComponent: ProfileRoutePending,
  pendingMs: 0,
});
