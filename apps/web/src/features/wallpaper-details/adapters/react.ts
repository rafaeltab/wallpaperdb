import { useCallback, useLayoutEffect, useMemo } from 'react';
import { toast } from 'sonner';
import type { Variant } from '@/lib/graphql/types';
import { downloadVariant } from './download';
import { shareWallpaper } from './share';

export function useWallpaperActions(wallpaperId: string | undefined) {
  const lifetime = useMemo(() => ({ wallpaperId, active: false, generation: 0 }), [wallpaperId]);
  // End feedback ownership during commit, before a queued completion can reach replacement UI.
  useLayoutEffect(() => {
    lifetime.active = true;
    // A replayed setup must not revive requests accepted before its cleanup.
    lifetime.generation++;
    return () => {
      lifetime.active = false;
    };
  }, [lifetime]);

  const share = useCallback(async () => {
    if (!lifetime.wallpaperId) return;
    const generation = lifetime.generation;
    const result = await shareWallpaper(lifetime.wallpaperId);
    if (!lifetime.active || lifetime.generation !== generation) return;
    if (result === 'copied') toast.success('Link copied to clipboard');
    if (result === 'failed') toast.error('Failed to copy link');
  }, [lifetime]);

  const download = useCallback(
    async (variant: Variant) => {
      const generation = lifetime.generation;
      try {
        await downloadVariant(variant);
      } catch {
        if (lifetime.active && lifetime.generation === generation)
          toast.error('Failed to download wallpaper');
      }
    },
    [lifetime]
  );

  return { share, download };
}
