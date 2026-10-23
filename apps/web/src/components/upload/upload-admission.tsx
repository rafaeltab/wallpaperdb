import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import { uploadPolicy } from '@/features/wallpaper-creation/adapters/http';
import { UploadDropZone } from './upload-drop-zone';
export function WallpaperUploadSelection({
  onFilesSelected,
  maxFiles,
  disabled = false,
}: {
  onFilesSelected: (files: File[]) => void;
  maxFiles?: number;
  disabled?: boolean;
}) {
  const { userId, isSignedIn } = useAuth();
  const policy = useQuery({
    queryKey: ['wallpaper-source-policy', userId],
    enabled: !!isSignedIn,
    queryFn: ({ signal }) => uploadPolicy(signal),
    refetchOnMount: 'always',
  });
  return (
    <div className="space-y-2">
      {policy.isPending && <p>Loading upload policy…</p>}
      {policy.isError && (
        <p role="alert">
          Upload policy is temporarily unavailable. Refresh it before selecting images.
        </p>
      )}
      <UploadDropZone
        onFilesSelected={onFilesSelected}
        maxFiles={maxFiles}
        maxBytes={policy.data?.maxBytes}
        disabled={disabled || !policy.data || policy.isFetching}
        description={
          policy.data
            ? `Still JPEG, PNG, and WebP images. Up to ${policy.data.maxBytes / (1024 * 1024)} MiB, ${policy.data.maxPixels.toLocaleString('en-US')} pixels total, and ${policy.data.maxAxis.toLocaleString('en-US')} pixels per axis.`
            : undefined
        }
      />
      <button
        type="button"
        className="text-xs underline"
        disabled={policy.isFetching}
        onClick={() => void policy.refetch()}
      >
        Refresh upload policy
      </button>
    </div>
  );
}
