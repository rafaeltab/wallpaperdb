import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { AlertCircle, FileImage, FileVideo, Loader2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { uploadWallpaper } from '@/lib/api/ingestor';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/upload')({
  component: UploadPage,
});

const DEMO_USER_ID = 'user_demo_001';

function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const router = useRouter();

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      // Simulate progress (real implementation would use XMLHttpRequest with onUploadProgress)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      try {
        const result = await uploadWallpaper(file, DEMO_USER_ID);
        setUploadProgress(100);
        return result;
      } finally {
        clearInterval(progressInterval);
      }
    },
    onSuccess: () => {
      toast.success('Wallpaper uploaded successfully!', {
        description: 'Your wallpaper is now being processed.',
      });
      queryClient.invalidateQueries({ queryKey: ['wallpapers'] });
      router.navigate({ to: '/' });
    },
    onError: (error: Error) => {
      toast.error('Upload failed', {
        description: error.message,
      });
      setUploadProgress(0);
    },
  });

  const handleFileChange = (selectedFile: File | null) => {
    setFile(selectedFile);
    setUploadProgress(0);

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    handleFileChange(selectedFile);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileChange(droppedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = () => {
    setIsDragActive(false);
  };

  const clearFile = () => {
    setFile(null);
    setPreview(null);
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (file) {
      uploadMutation.mutate(file);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Upload Wallpaper</CardTitle>
          <CardDescription>
            Add a new wallpaper to your collection. Supported formats: JPEG, PNG, WebP (images) or
            MP4, WebM (videos).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Drop Zone */}
            <div className="space-y-2">
              <Label htmlFor="file-upload">Select File</Label>
              <div
                role="button"
                tabIndex={0}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={cn(
                  'relative border-2 border-dashed rounded-lg p-8 transition-colors cursor-pointer',
                  'hover:border-primary/50 hover:bg-muted/50',
                  'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                  isDragActive && 'border-primary bg-primary/5',
                  uploadMutation.isPending && 'pointer-events-none opacity-50'
                )}
              >
                <Input
                  ref={fileInputRef}
                  id="file-upload"
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleInputChange}
                  disabled={uploadMutation.isPending}
                  className="sr-only"
                />
                <div className="flex flex-col items-center gap-2 text-center">
                  <Upload className="h-10 w-10 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      {isDragActive ? 'Drop file here' : 'Click to upload or drag and drop'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Images up to 50MB, Videos up to 200MB
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* File Preview */}
            {file && (
              <div className="space-y-4">
                {preview && (
                  <div className="relative">
                    <img
                      src={preview}
                      alt="Preview"
                      className="w-full max-h-64 object-contain rounded-lg border bg-muted"
                    />
                  </div>
                )}

                {/* File Info */}
                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50">
                  <div className="flex items-center gap-3">
                    {file.type.startsWith('image/') ? (
                      <FileImage className="h-8 w-8 text-primary" />
                    ) : (
                      <FileVideo className="h-8 w-8 text-primary" />
                    )}
                    <div>
                      <p className="text-sm font-medium truncate max-w-[200px]">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearFile();
                    }}
                    disabled={uploadMutation.isPending}
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Remove file</span>
                  </Button>
                </div>
              </div>
            )}

            {/* Upload Progress */}
            {uploadMutation.isPending && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Uploading...</span>
                  <span className="font-medium">{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} />
              </div>
            )}

            {/* Error Alert */}
            {uploadMutation.error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Upload failed</AlertTitle>
                <AlertDescription>{uploadMutation.error.message}</AlertDescription>
              </Alert>
            )}

            {/* Submit Button */}
            <Button type="submit" className="w-full" disabled={!file || uploadMutation.isPending}>
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
