import {
  profileInitials,
  profileFallbackColor,
  projectionRetryDelay,
  resolveProfilePicture,
} from '@/features/public-profile';
import { useEffect, useState } from 'react';
import { useOwnerProfile } from '@/hooks/use-owner-profile';
import type { Profile as OwnerProfile } from '@/lib/api/user';
import type { Profile } from '@/lib/graphql/types';

interface ProfilePictureProps {
  profile:
    | Pick<Profile, 'id' | 'displayName' | 'picture' | 'version'>
    | Pick<OwnerProfile, 'id' | 'displayName' | 'pictureAssetId'>;
  className?: string;
}

export function ProfilePicture({ profile, className }: ProfilePictureProps) {
  const { profile: cachedOwner, refreshedAt } = useOwnerProfile(profile.id);
  const resolved = resolveProfilePicture(
    profile,
    cachedOwner,
    import.meta.env.VITE_MEDIA_URL || '/media'
  );
  const picture = resolved.picture;
  const publicVersion = 'version' in profile ? profile.version : 0;
  return (
    <ProfilePictureImage
      key={`${profile.id}:${picture?.url ?? ''}:${refreshedAt}:${publicVersion}`}
      profile={resolved}
      className={className}
    />
  );
}

export function ProfilePictureImage({
  profile,
  className = 'flex size-24 shrink-0 items-center justify-center rounded-2xl border-4 border-card object-cover text-2xl font-bold text-white shadow-sm sm:size-28 sm:text-3xl',
}: {
  profile: Pick<Profile, 'id' | 'displayName' | 'picture'>;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [retries, setRetries] = useState(0);
  const accessibleName = `${profile.displayName}'s profile picture`;

  useEffect(() => {
    const delay = projectionRetryDelay(retries, false);
    if (!failed || delay === undefined) return;
    const timeout = window.setTimeout(() => {
      setRetries((count) => count + 1);
      setFailed(false);
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [failed, retries]);

  useEffect(() => {
    if (!failed || retries < 3) return;
    const retry = () => {
      setRetries(0);
      setFailed(false);
    };
    const visible = () => {
      if (document.visibilityState === 'visible') retry();
    };
    window.addEventListener('focus', retry);
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', retry);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', visible);
    };
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
      style={{ backgroundColor: profileFallbackColor(profile.id) }}
    >
      {profileInitials(profile.displayName)}
    </div>
  );
}
