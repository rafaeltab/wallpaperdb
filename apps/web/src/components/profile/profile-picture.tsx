import type { Profile } from '@/lib/graphql/types';

interface ProfilePictureProps {
  profile: Pick<Profile, 'id' | 'displayName' | 'picture'>;
  className?: string;
}

export function ProfilePicture({
  profile,
  className = 'flex size-24 shrink-0 items-center justify-center rounded-2xl border-4 border-card object-cover text-2xl font-bold text-white shadow-sm sm:size-28 sm:text-3xl',
}: ProfilePictureProps) {
  const accessibleName = `${profile.displayName}'s profile picture`;

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
