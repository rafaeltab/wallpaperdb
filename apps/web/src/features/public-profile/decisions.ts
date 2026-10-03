export function profileInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  return `${words[0]?.[0] ?? '?'}${words.length > 1 ? (words.at(-1)?.[0] ?? '') : ''}`.toUpperCase();
}

export function profileFallbackColor(profileId: string): string {
  let hash = 0;
  for (const character of profileId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 58% 42%)`;
}

export function canonicalProfileOutcome<Profile>(
  resolution: { profile: Profile; canonicalHandle: string } | null,
  requestedHandle?: string
):
  | { kind: 'missing' }
  | { kind: 'redirect'; handle: string }
  | { kind: 'profile'; profile: Profile } {
  if (!resolution) return { kind: 'missing' };
  if (requestedHandle !== resolution.canonicalHandle)
    return { kind: 'redirect', handle: resolution.canonicalHandle };
  return { kind: 'profile', profile: resolution.profile };
}
export function embeddedWallpaperState<Variant>(
  wallpaper: { wallpaperId: string; profileId: string; variants: Variant[] } | null | undefined,
  wallpaperId: string,
  profileId: string
) {
  const variant = wallpaper?.variants[0];
  const matches = wallpaper?.wallpaperId === wallpaperId && wallpaper.profileId === profileId;
  return {
    variant,
    matches,
    retryable: !wallpaper || (matches && !variant),
    available: Boolean(matches && variant),
  };
}
export function projectionRetryDelay(
  attempt: number,
  admissionDenied: boolean
): number | undefined {
  return admissionDenied || attempt >= 3 ? undefined : 1000 * 2 ** attempt;
}
type PictureSource = {
  id: string;
  displayName: string;
  version?: number;
  picture?: { id: string; url: string } | null;
  pictureAssetId?: string | null;
};
export function resolveProfilePicture(
  profile: PictureSource,
  cachedOwner: (PictureSource & { version: number }) | null | undefined,
  mediaUrl: string
) {
  const owner =
    'pictureAssetId' in profile
      ? profile
      : cachedOwner &&
          cachedOwner.id === profile.id &&
          cachedOwner.version >= (profile.version ?? 0)
        ? cachedOwner
        : null;
  const picture = owner
    ? owner.pictureAssetId
      ? {
          id: owner.pictureAssetId,
          url: `${mediaUrl.replace(/\/+$/, '')}/profile-pictures/${encodeURIComponent(owner.pictureAssetId)}`,
        }
      : null
    : (profile.picture ?? null);
  return { id: profile.id, displayName: owner?.displayName ?? profile.displayName, picture };
}
