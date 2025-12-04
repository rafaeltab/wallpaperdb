import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: () => (
    <div className="text-center">
      <h2 className="text-2xl font-semibold text-gray-700 mb-4">
        Welcome to WallpaperDB
      </h2>
      <p className="text-gray-600">
        Frontend setup complete. Ready for Phase 2: Core Infrastructure.
      </p>
    </div>
  ),
});
