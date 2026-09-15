import { Link } from '@tanstack/react-router';
import { useWallpaperQuery } from '@/hooks/useWallpaperQuery';

export function BiographyWallpaper({
  wallpaperId,
  profileId,
  alt,
}: {
  wallpaperId: string;
  profileId: string;
  alt: string;
}) {
  const query = useWallpaperQuery(wallpaperId);
  if (query.isPending)
    return <output className="my-4 block text-sm text-muted-foreground">Loading wallpaper…</output>;
  const wallpaper = query.data;
  const variant = wallpaper?.variants[0];
  if (
    !wallpaper ||
    wallpaper.wallpaperId !== wallpaperId ||
    wallpaper.profileId !== profileId ||
    !variant
  ) {
    return (
      <span className="my-4 block rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Wallpaper unavailable.
      </span>
    );
  }
  return (
    <span className="my-4 block overflow-hidden rounded-xl border bg-muted/30">
      <Link
        to="/wallpapers/$wallpaperId"
        params={{ wallpaperId }}
        className="block outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <img
          src={variant.url}
          alt={alt || 'Wallpaper'}
          width={variant.width}
          height={variant.height}
          loading="lazy"
          className="max-h-96 w-full object-contain"
        />
        <span className="block px-3 py-2 text-sm font-medium text-primary">View wallpaper</span>
      </Link>
    </span>
  );
}
