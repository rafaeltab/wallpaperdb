export function pictureSelection<T extends { type: string; size: number }>(
  picture: T | undefined,
  maxBytes: number
): { selected: T | null; error: string | null } {
  if (picture && !['image/jpeg', 'image/png', 'image/webp'].includes(picture.type))
    return { selected: null, error: 'Choose a JPEG, PNG, or WebP picture.' };
  if (picture && picture.size > maxBytes)
    return { selected: null, error: `Picture must be at most ${maxBytes.toLocaleString()} bytes.` };
  return { selected: picture ?? null, error: null };
}
export function pictureImportPollInterval(
  status: string | undefined,
  writing: boolean
): number | false {
  return !writing && (status === 'pending' || status === 'retrying') ? 5000 : false;
}
export function shouldClearOwnerProfile(
  previous: string | null,
  active: string | null,
  loaded: boolean
): boolean {
  return loaded && (!active || Boolean(previous && previous !== active));
}
