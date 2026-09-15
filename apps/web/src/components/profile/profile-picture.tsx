import { useEffect, useState } from 'react';
import type { Profile } from '@/lib/graphql/types';

interface ProfilePictureProps {
  profile: Pick<Profile, 'id' | 'displayName' | 'picture'>;
  className?: string;
}

export function ProfilePicture({
  profile,
  className = 'flex size-24 shrink-0 items-center justify-center rounded-2xl border-4 border-card object-cover text-2xl font-bold text-white shadow-sm sm:size-28 sm:text-3xl',
}: ProfilePictureProps) {
  return (
    <Picture
      key={`${profile.id}:${profile.picture?.url ?? ''}`}
      profile={profile}
      className={className}
    />
  );
}

function Picture({ profile, className }: ProfilePictureProps) {
  const [failed, setFailed] = useState(false);
  const [retries, setRetries] = useState(0);
  const accessibleName = `${profile.displayName}'s profile picture`;

  useEffect(() => {
    if (!failed || retries >= 3) return;
    const timeout = window.setTimeout(
      () => {
        setRetries((count) => count + 1);
        setFailed(false);
      },
      1000 * 2 ** retries
    );
    return () => window.clearTimeout(timeout);
  }, [failed, retries]);

  if (profile.picture && !failed) {
    return (
      <img
        className={className}
        src={profile.picture.url}
        alt={accessibleName}
        onError={() => setFailed(true)}
      />
    );
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
