import type { Wallpaper } from '@/lib/graphql/types';

interface WallpaperGridProps {
  wallpapers: Wallpaper[];
}

export function WallpaperGrid({ wallpapers }: WallpaperGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {wallpapers.map((wallpaper) => (
        <div
          key={wallpaper.wallpaperId}
          className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow overflow-hidden"
        >
          {wallpaper.variants[0] && (
            <img
              src={wallpaper.variants[0].url}
              alt="Wallpaper"
              className="w-full aspect-video object-cover"
              loading="lazy"
            />
          )}
          <div className="p-4">
            <p className="text-sm text-gray-500">
              {wallpaper.variants.length} variant{wallpaper.variants.length !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Uploaded {new Date(wallpaper.uploadedAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
