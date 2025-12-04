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
    if (selectedFile?.type.startsWith('image/')) {
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
            <label htmlFor="file-upload" className="block text-sm font-medium text-gray-700 mb-2">
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
                <span className="font-medium">Size:</span> {(file.size / 1024 / 1024).toFixed(2)} MB
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
