import type { Profile } from '@/lib/graphql/types';

interface PublicProfilePageProps {
  profile: Profile;
}

export function PublicProfilePage({ profile }: PublicProfilePageProps) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="h-24 bg-linear-to-r from-primary/20 via-primary/10 to-transparent sm:h-32" />
        <div className="px-5 pb-7 sm:px-8 sm:pb-9">
          <div className="-mt-12 flex flex-col gap-5 sm:-mt-14 sm:flex-row sm:items-end sm:gap-7">
            <ProfilePicture profile={profile} />
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
            {profile.biographyMarkdown.trim() ? (
              <p className="mt-3 max-w-3xl whitespace-pre-wrap text-base leading-7 text-card-foreground">
                {profile.biographyMarkdown}
              </p>
            ) : (
              <p className="mt-3 text-base italic text-muted-foreground">No biography yet.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ProfilePicture({ profile }: PublicProfilePageProps) {
  const accessibleName = `${profile.displayName}'s profile picture`;
  const className =
    'flex size-24 shrink-0 items-center justify-center rounded-2xl border-4 border-card object-cover text-2xl font-bold text-white shadow-sm sm:size-28 sm:text-3xl';

  if (profile.picture) {
    return <img className={className} src={profile.picture.url} alt={accessibleName} />;
  }

  return (
    <div
      role="img"
      aria-label={accessibleName}
      className={className}
      style={{ backgroundColor: fallbackColor(profile.id) }}
    >
      {initials(profile.displayName)}
    </div>
  );
}

function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  return `${words[0]?.[0] ?? '?'}${words.length > 1 ? (words.at(-1)?.[0] ?? '') : ''}`.toUpperCase();
}

function fallbackColor(profileId: string): string {
  let hash = 0;
  for (const character of profileId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 58% 42%)`;
}
