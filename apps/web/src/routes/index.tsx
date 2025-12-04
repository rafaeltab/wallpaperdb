import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { graphqlClient } from '@/lib/graphql/client';
import { SEARCH_WALLPAPERS } from '@/lib/graphql/queries';
import type { WallpaperConnection } from '@/lib/graphql/types';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['wallpapers'],
    queryFn: async () => {
      return graphqlClient.request<{ searchWallpapers: WallpaperConnection }>(SEARCH_WALLPAPERS, {
        first: 20,
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-600">Loading wallpapers...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-red-600">Error: {error.message}</div>
      </div>
    );
  }

  const wallpapers = data?.searchWallpapers.edges.map((edge) => edge.node) || [];

  if (wallpapers.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <p className="text-gray-600 mb-4">No wallpapers found</p>
          <Link to="/upload" className="text-blue-600 hover:text-blue-700 font-medium">
            Upload your first wallpaper
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Wallpapers</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {wallpapers.map((wallpaper) => (
          <div
            key={wallpaper.wallpaperId}
            className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow overflow-hidden"
          >
            {/* Display first variant thumbnail */}
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
    </div>
  );
}
