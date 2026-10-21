import {
  profileInitials,
  profileFallbackColor,
  projectionRetryDelay,
  resolveProfilePicture,
} from '@/features/public-profile';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
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
    import.meta.env.VITE_ASSET_URL || '/asset'
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
  className,
}: {
  profile: Pick<Profile, 'id' | 'displayName' | 'picture'>;
  className?: string;
}) {
  return (
    <ProfilePictureLoad
      key={`${profile.id}:${profile.picture?.id ?? ''}:${profile.picture?.url ?? ''}`}
      profile={profile}
      className={className}
    />
  );
}

function ProfilePictureLoad({
  profile,
  className = 'flex size-24 shrink-0 items-center justify-center border-4 border-card object-cover text-2xl font-bold text-white shadow-sm sm:size-28 sm:text-3xl',
}: {
  profile: Pick<Profile, 'id' | 'displayName' | 'picture'>;
  className?: string;
}) {
  const pictureClassName = cn(className, 'rounded-full');
  const [status, setStatus] = useState<'loading' | 'waiting' | 'ready' | 'unavailable'>('loading');
  const [retries, setRetries] = useState(0);
  const pending = Boolean(profile.picture) && (status === 'loading' || status === 'waiting');
  const accessibleName = `${profile.displayName}'s profile picture`;

  useEffect(() => {
    const delay = projectionRetryDelay(retries, false);
    if (status !== 'waiting' || delay === undefined) return;
    const timeout = window.setTimeout(() => {
      setRetries((count) => count + 1);
      setStatus((current) => (current === 'waiting' ? 'loading' : current));
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [status, retries]);

  useEffect(() => {
    if (!pending) return;
    const timeout = window.setTimeout(() => setStatus('unavailable'), 15000);
    return () => window.clearTimeout(timeout);
  }, [pending]);

  useEffect(() => {
    if (!profile.picture || status !== 'unavailable') return;
    const retry = () => {
      setRetries(0);
      setStatus('loading');
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
  }, [status, profile.picture]);

  if (profile.picture && status !== 'unavailable') {
    const ready = status === 'ready';
    const failed = () =>
      setStatus((current) =>
        current === 'loading'
          ? projectionRetryDelay(retries, false) === undefined
            ? 'unavailable'
            : 'waiting'
          : current
      );
    const image = (
      <img
        ref={(image) => {
          if (!image || ready) return;
          let active = true;
          const loaded = () => {
            void image.decode().then(
              () => {
                if (active) setStatus((current) => (current === 'loading' ? 'ready' : current));
              },
              () => {
                if (active) failed();
              }
            );
          };
          if (image.complete && image.naturalWidth > 0) loaded();
          else image.addEventListener('load', loaded, { once: true });
          return () => {
            active = false;
            image.removeEventListener('load', loaded);
          };
        }}
        className={cn(
          'absolute inset-0 size-full rounded-full object-cover',
          !ready && 'opacity-0'
        )}
        src={profile.picture.url}
        alt={accessibleName}
        aria-hidden="true"
        onError={failed}
      />
    );
    return (
      <>
        <div
          role="img"
          aria-label={accessibleName}
          className={cn(pictureClassName, 'relative', !ready && 'bg-muted')}
        >
          {(status === 'loading' || ready) && image}
          {!ready && (
            <LoaderCircle
              aria-hidden="true"
              className="size-[40%] max-h-6 max-w-6 animate-spin text-muted-foreground motion-reduce:animate-none"
            />
          )}
        </div>
        {/* Keep the live status outside image roles and enclosing controls' accessible names. */}
        {!ready &&
          createPortal(
            <output aria-live="polite" className="sr-only">
              Loading profile picture
            </output>,
            document.body
          )}
      </>
    );
  }

  return (
    <div
      role="img"
      aria-label={accessibleName}
      aria-description={profile.picture ? 'Profile picture unavailable' : undefined}
      className={pictureClassName}
      style={{ backgroundColor: profileFallbackColor(profile.id) }}
    >
      {profileInitials(profile.displayName)}
    </div>
  );
}
