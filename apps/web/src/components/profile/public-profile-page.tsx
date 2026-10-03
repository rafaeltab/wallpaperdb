import { feedPresentation } from '@/features/browse';
import { useAuth } from '@clerk/react';
import { Link } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { LoadMoreTrigger } from '@/components/LoadMoreTrigger';
import { GraphQLError } from '@/components/graphql-error';
import { Button } from '@/components/ui/button';
import { WallpaperGrid } from '@/components/WallpaperGrid';
import { useOwnerProfile } from '@/hooks/use-owner-profile';
import { useWallpaperInfiniteQuery } from '@/hooks/useWallpaperInfiniteQuery';
import type { Profile } from '@/lib/graphql/types';
import { ProfileBiography } from './profile-biography';
import { ProfileOverview } from './profile-overview';
import { ProfilePicture } from './profile-picture';

export { ProfileOverview } from './profile-overview';

interface PublicProfilePageProps {
  profile: Profile;
}

export function PublicProfilePage({ profile }: PublicProfilePageProps) {
  const { isSignedIn, userId } = useAuth();
  const { profile: owner } = useOwnerProfile(profile.id);
  const identity =
    owner?.id === profile.id && owner.version >= (profile.version ?? 0) ? owner : profile;
  const isOwner = isSignedIn && userId === profile.id;
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <ProfileOverview
        profile={identity}
        picture={<ProfilePicture profile={profile} />}
        biography={<ProfileBiography profile={profile} />}
        actions={
          isOwner && (
            <Button asChild variant="outline" size="sm" className="bg-background/90">
              <Link to="/settings/profile">
                <Pencil className="size-4" />
                Edit profile
              </Link>
            </Button>
          )
        }
      />

      <ProfileWallpapers profileId={profile.id} />
    </div>
  );
}

export function ProfileWallpapers({ profileId }: { profileId: string }) {
  const {
    data,
    isLoading,
    isFetchingNextPage,
    isFetchNextPageError,
    error: queryError,
    failureReason,
    isFetching,
    refetch,
    hasNextPage,
    fetchNextPage,
  } = useWallpaperInfiniteQuery({ filter: { profileId } });
  const wallpapers = data?.pages.flatMap((page) => page.edges.map((edge) => edge.node)) ?? [];
  const feed = feedPresentation({
    error: queryError,
    failureReason,
    itemCount: wallpapers.length,
    isLoading,
    isFetchNextPageError,
    isFetchingNextPage,
  });
  const { error } = feed;
  let content: ReactNode;

  if (feed.initialError) {
    content = (
      <GraphQLError
        error={error}
        retry={refetch}
        retrying={isFetching}
        title="Could not load wallpapers"
      />
    );
  } else if (feed.showResults) {
    content = (
      <>
        <WallpaperGrid
          wallpapers={wallpapers}
          isLoading={isLoading}
          isLoadingMore={isFetchingNextPage}
        />
        {error ? (
          <div className="mt-4">
            <GraphQLError
              error={error}
              retry={feed.retryTarget === 'next-page' ? fetchNextPage : refetch}
              retrying={isFetching}
              title="Could not load more wallpapers"
            />
          </div>
        ) : (
          <LoadMoreTrigger
            onLoadMore={() => void fetchNextPage()}
            hasMore={Boolean(hasNextPage)}
            isLoading={isFetchingNextPage}
          />
        )}
      </>
    );
  } else {
    content = (
      <p className="rounded-xl border border-dashed px-5 py-10 text-center text-muted-foreground">
        No wallpapers yet.
      </p>
    );
  }

  return (
    <section className="mt-10" aria-label="Wallpapers">
      {content}
    </section>
  );
}
