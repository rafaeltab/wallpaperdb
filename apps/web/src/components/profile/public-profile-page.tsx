import { useAuth } from '@clerk/react';
import { Link } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { LoadMoreTrigger } from '@/components/LoadMoreTrigger';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { WallpaperGrid } from '@/components/WallpaperGrid';
import { useWallpaperInfiniteQuery } from '@/hooks/useWallpaperInfiniteQuery';
import type { Profile } from '@/lib/graphql/types';
import { ProfileBiography } from './profile-biography';
import { ProfilePicture } from './profile-picture';

interface PublicProfilePageProps {
  profile: Profile;
}

export function PublicProfilePage({ profile }: PublicProfilePageProps) {
  const { isSignedIn, userId } = useAuth();
  const isOwner = isSignedIn && userId === profile.id;
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <ProfileOverview
        profile={profile}
        picture={<ProfilePicture profile={profile} />}
        biography={<ProfileBiography profile={profile} />}
        actions={
          isOwner && (
            <Button asChild variant="outline" size="sm" className="bg-background/90">
              <Link to="/settings/profile" search={import.meta.env.DEV ? { variant: 'D' } : {}}>
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

export function ProfileOverview({
  profile,
  picture,
  biography,
  actions,
}: {
  profile: Pick<Profile, 'displayName' | 'handle'>;
  picture: ReactNode;
  biography: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="relative h-24 bg-linear-to-r from-primary/20 via-primary/10 to-transparent sm:h-32">
        {actions && <div className="absolute top-4 right-4">{actions}</div>}
      </div>
      <div className="px-5 pb-7 sm:px-8 sm:pb-9">
        <div className="relative -mt-12 flex flex-col gap-5 sm:-mt-14 sm:flex-row sm:items-end sm:gap-7">
          {picture}
          <div className="min-w-0 pb-1">
            <h1 className="break-words text-3xl font-bold tracking-tight text-card-foreground sm:text-4xl">
              {profile.displayName}
            </h1>
            <p className="mt-1 break-all text-base text-muted-foreground sm:text-lg">
              @{profile.handle}
            </p>
          </div>
        </div>

        <div className="mt-8 border-t pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Biography
          </h2>
          <div className="mt-3 min-w-0 max-w-3xl">{biography}</div>
        </div>
      </div>
    </section>
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
    <section className="mt-10" aria-labelledby="profile-wallpapers-heading">
      <h2 id="profile-wallpapers-heading" className="mb-5 text-2xl font-bold tracking-tight">
        Wallpapers
      </h2>
      {content}
    </section>
  );
}
