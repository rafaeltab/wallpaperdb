import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import type { QueryClient } from '@tanstack/react-query';

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center gap-8">
            <h1 className="text-xl font-bold text-gray-900">WallpaperDB</h1>
            <div className="flex gap-6">
              <Link
                to="/"
                className="text-gray-700 hover:text-gray-900 font-medium transition-colors"
                activeProps={{ className: 'text-blue-600 font-semibold' }}
              >
                Browse
              </Link>
              <Link
                to="/upload"
                className="text-gray-700 hover:text-gray-900 font-medium transition-colors"
                activeProps={{ className: 'text-blue-600 font-semibold' }}
              >
                Upload
              </Link>
            </div>
          </div>
        </div>
      </nav>
      <main className="py-8">
        <Outlet />
      </main>
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  );
}
