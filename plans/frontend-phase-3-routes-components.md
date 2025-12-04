# Phase 3: Routes & Components

**Goal:** Create the TanStack Router routes (root layout, home page, upload page) and HTML entry point.

---

## Prerequisites

- **Phase 1 complete:** Project setup done
- **Phase 2 complete:** Core infrastructure (GraphQL client, types, App.tsx) created

---

## TanStack Router Structure

TanStack Router uses file-based routing:
- `src/routes/__root.tsx` - Root layout (wraps all routes)
- `src/routes/index.tsx` - Home page (`/`)
- `src/routes/upload.tsx` - Upload page (`/upload`)

The TanStack Router Vite plugin auto-generates `src/routeTree.gen.ts` based on these files.

---

## Tasks

### 3.1 Create Root Layout

**File:** `apps/web/src/routes/__root.tsx`

```typescript
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
      <main className="max-w-7xl mx-auto px-4 py-8">
        <Outlet />
      </main>
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  );
}
```

---

### 3.2 Create Home Page (Browse Wallpapers)

**File:** `apps/web/src/routes/index.tsx`

```typescript
import { createFileRoute } from '@tanstack/react-router';
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
      return graphqlClient.request<{ searchWallpapers: WallpaperConnection }>(
        SEARCH_WALLPAPERS,
        { first: 20 }
      );
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
          <Link
            to="/upload"
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
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
```

---

### 3.3 Create Upload Page

**File:** `apps/web/src/routes/upload.tsx`

```typescript
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadWallpaper } from '@/lib/api/ingestor';
import { useState } from 'react';

export const Route = createFileRoute('/upload')({
  component: UploadPage,
});

function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();

  const uploadMutation = useMutation({
    mutationFn: uploadWallpaper,
    onSuccess: () => {
      // Invalidate wallpapers query to refetch
      queryClient.invalidateQueries({ queryKey: ['wallpapers'] });
      // Navigate to home page
      router.navigate({ to: '/' });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    setFile(selectedFile);

    // Generate preview for images
    if (selectedFile && selectedFile.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
    } else {
      setPreview(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (file) {
      uploadMutation.mutate(file);
    }
  };

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Upload Wallpaper</h1>
      <div className="max-w-2xl">
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
          <div className="mb-6">
            <label
              htmlFor="file-upload"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Select Image or Video
            </label>
            <input
              id="file-upload"
              type="file"
              accept="image/*,video/*"
              onChange={handleFileChange}
              disabled={uploadMutation.isPending}
              className="block w-full text-sm text-gray-500
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-semibold
                file:bg-blue-50 file:text-blue-700
                hover:file:bg-blue-100
                file:cursor-pointer cursor-pointer
                disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="mt-2 text-xs text-gray-500">
              Supported formats: JPEG, PNG, WebP (images) or MP4, WebM (videos)
            </p>
          </div>

          {preview && (
            <div className="mb-6">
              <p className="text-sm font-medium text-gray-700 mb-2">Preview:</p>
              <img
                src={preview}
                alt="Preview"
                className="max-w-full h-auto rounded-lg border border-gray-200"
              />
            </div>
          )}

          {file && (
            <div className="mb-6 text-sm text-gray-600">
              <p>
                <span className="font-medium">File:</span> {file.name}
              </p>
              <p>
                <span className="font-medium">Size:</span>{' '}
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={!file || uploadMutation.isPending}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md
              hover:bg-blue-700 transition-colors font-medium
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
          </button>

          {uploadMutation.error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800 font-medium">Upload failed</p>
              <p className="text-sm text-red-600 mt-1">{uploadMutation.error.message}</p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
```

---

### 3.4 Create HTML Entry Point

**File:** `apps/web/index.html`

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="WallpaperDB - Browse and upload wallpapers" />
    <title>WallpaperDB</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

---

## Files Created

- `apps/web/src/routes/__root.tsx`
- `apps/web/src/routes/index.tsx`
- `apps/web/src/routes/upload.tsx`
- `apps/web/index.html`

---

## Auto-Generated Files

After running `make web-dev` (or any build command), TanStack Router will auto-generate:
- `apps/web/src/routeTree.gen.ts`

**Do not manually edit this file** - it's regenerated automatically.

---

## Verification

After completing this phase:

1. **Type check:** `make web-check` (should pass)
2. **Format & lint:** `make web-format && make web-lint`
3. **Start dev server:** `make web-dev`
4. **Open browser:** http://localhost:3003

**Expected behavior:**
- Home page (`/`) should attempt to fetch wallpapers from Gateway
- Upload page (`/upload`) should show upload form
- Navigation should work between pages
- TanStack Router devtools should be visible in bottom-right

**Note:** If Gateway is not running, home page will show an error. This is expected - you need Gateway running to see wallpapers.

---

## Next Phase

**Phase 4:** Environment Configuration (`frontend-phase-4-environment-config.md`)
- Create .env.example
- Update .gitignore
- Document environment variables
