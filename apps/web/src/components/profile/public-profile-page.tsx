import { useAuth } from '@clerk/react';
import { Link } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { LoadMoreTrigger } from '@/components/LoadMoreTrigger';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  const { data, isLoading, isFetchingNextPage, error, hasNextPage, fetchNextPage } =
    useWallpaperInfiniteQuery({ filter: { profileId } });
  const wallpapers = data?.pages.flatMap((page) => page.edges.map((edge) => edge.node)) ?? [];
  let content: ReactNode;

  if (error && wallpapers.length === 0) {
    content = (
      <Alert variant="destructive">
        <AlertTitle>Could not load wallpapers</AlertTitle>
        <AlertDescription>Please try again later.</AlertDescription>
      </Alert>
    );
  } else if (wallpapers.length > 0 || isLoading) {
    content = (
      <>
        <WallpaperGrid wallpapers={wallpapers} isLoadingMore={isLoading || isFetchingNextPage} />
        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>Could not load more wallpapers</AlertTitle>
            <AlertDescription>Your loaded wallpapers are still available.</AlertDescription>
          </Alert>
        )}
        <LoadMoreTrigger
          onLoadMore={() => void fetchNextPage()}
          hasMore={Boolean(hasNextPage)}
          isLoading={isFetchingNextPage}
        />
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
