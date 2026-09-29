import { GraphQLError } from '@/components/graphql-error';
import { GatewayAdmissionError } from '@/lib/graphql/admission';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
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
  const query = useWallpaperQuery(wallpaperId, { staleTime: 0 });
  const [retries, setRetries] = useState(0);
  const error = query.failureReason ?? query.error;
  const admissionFailed = error instanceof GatewayAdmissionError;
  const wallpaper = query.data;
  const variant = wallpaper?.variants?.[0];
  const matches = wallpaper?.wallpaperId === wallpaperId && wallpaper.profileId === profileId;
  const retryable = !wallpaper || (matches && !variant);
  useEffect(() => {
    if (query.isPending || query.isFetching || admissionFailed || !retryable || retries >= 3)
      return;
    const timeout = window.setTimeout(
      () => {
        setRetries((count) => count + 1);
        void query.refetch();
      },
      1000 * 2 ** retries
    );
    return () => window.clearTimeout(timeout);
  }, [query.isPending, query.isFetching, query.refetch, admissionFailed, retryable, retries]);
  const errorDisplay = admissionFailed ? (
    <GraphQLError
      error={error}
      retry={() => query.refetch()}
      retrying={query.isFetching}
      retryLabel="Try wallpaper again"
    />
  ) : null;
  if (errorDisplay && (!matches || !variant)) return errorDisplay;
  if (query.isPending)
    return <output className="my-4 block text-sm text-muted-foreground">Loading wallpaper…</output>;
  if (
    !wallpaper ||
    wallpaper.wallpaperId !== wallpaperId ||
    wallpaper.profileId !== profileId ||
    !variant
  ) {
    return (
      <span className="my-4 block rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Wallpaper unavailable.
        {retryable && (
          <button
            type="button"
            aria-label="Try wallpaper again"
            disabled={query.isFetching}
            className="ml-2 cursor-pointer text-primary underline underline-offset-4 disabled:opacity-50"
            onClick={() => {
              setRetries(0);
              void query.refetch();
            }}
          >
            Try again
          </button>
        )}
      </span>
    );
  }
  return (
    <span className="my-4 block overflow-hidden rounded-xl border bg-muted/30">
      {errorDisplay}
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
