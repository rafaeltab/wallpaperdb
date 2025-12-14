import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  AlertCircle,
  Check,
  Copy,
  FileImage,
  FileVideo,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { UploadDropZone } from '@/components/upload/upload-drop-zone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { MAX_FILES_PER_BATCH, useUploadQueue } from '@/contexts/upload-queue-context';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/upload')({
  component: UploadPage,
});

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'pending':
      return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground" />;
    case 'uploading':
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    case 'success':
      return <Check className="h-4 w-4 text-green-500" />;
    case 'failed':
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    case 'duplicate':
      return <Copy className="h-4 w-4 text-yellow-500" />;
    default:
      return null;
  }
}

function UploadPage() {
  const { state, counts, progress, addFiles, clearCompleted, retryFailed, cancelAll } =
    useUploadQueue();
  const queryClient = useQueryClient();

  const hasFiles = state.files.length > 0;
  const isUploading = counts.uploading > 0 || counts.pending > 0;
  const isComplete = hasFiles && !isUploading && !state.isPaused;
  const hasFailures = counts.failed > 0;

  const handleFilesSelected = (files: File[]) => {
    const remainingCapacity = MAX_FILES_PER_BATCH - state.files.length;
    if (files.length > remainingCapacity && remainingCapacity > 0) {
      toast.warning(`Only ${remainingCapacity} more files can be added (max ${MAX_FILES_PER_BATCH})`);
    } else if (remainingCapacity === 0) {
      toast.error(`Maximum of ${MAX_FILES_PER_BATCH} files reached`);
      return;
    }
    addFiles(files);
  };

  const handleClearAll = () => {
    cancelAll();
    queryClient.invalidateQueries({ queryKey: ['wallpapers'] });
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Upload Wallpapers</CardTitle>
          <CardDescription>
            Add wallpapers to your collection. Supported formats: JPEG, PNG, WebP (images) or MP4,
            WebM (videos). You can upload up to {MAX_FILES_PER_BATCH} files at a time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Drop Zone */}
          <UploadDropZone
            onFilesSelected={handleFilesSelected}
            maxFiles={MAX_FILES_PER_BATCH - state.files.length}
            disabled={isUploading}
          />

          {/* Progress Summary */}
          {hasFiles && (
            <div className="space-y-4">
              {/* Overall Progress */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {isUploading
                      ? `Uploading ${counts.success + counts.failed + counts.duplicate}/${counts.total}...`
                      : state.isPaused
                        ? 'Paused (rate limited)'
                        : isComplete
                          ? 'Upload complete'
                          : 'Ready to upload'}
                  </span>
                  <span className="font-medium">{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>

              {/* Status Summary */}
              <div className="flex flex-wrap gap-2">
                {counts.success > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs bg-green-500/10 text-green-600 dark:text-green-400 px-2 py-1 rounded-full">
                    <Check className="h-3 w-3" />
                    {counts.success} uploaded
                  </span>
                )}
                {counts.duplicate > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 px-2 py-1 rounded-full">
                    <Copy className="h-3 w-3" />
                    {counts.duplicate} duplicate{counts.duplicate !== 1 ? 's' : ''}
                  </span>
                )}
                {counts.failed > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs bg-destructive/10 text-destructive px-2 py-1 rounded-full">
                    <AlertCircle className="h-3 w-3" />
                    {counts.failed} failed
                  </span>
                )}
                {counts.pending > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded-full">
                    {counts.pending} pending
                  </span>
                )}
              </div>

              {/* File List */}
              <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                {state.files.map((queuedFile) => (
                  <div
                    key={queuedFile.id}
                    className={cn(
                      'flex items-center gap-3 p-3',
                      queuedFile.status === 'failed' && 'bg-destructive/5'
                    )}
                  >
                    <div className="flex-shrink-0">
                      {queuedFile.file.type.startsWith('image/') ? (
                        <FileImage className="h-6 w-6 text-muted-foreground" />
                      ) : (
                        <FileVideo className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{queuedFile.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(queuedFile.file.size)}
                        {queuedFile.error && (
                          <span className="text-destructive ml-2">{queuedFile.error.message}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex-shrink-0">{getStatusIcon(queuedFile.status)}</div>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                {hasFailures && (
                  <Button
                    variant="outline"
                    onClick={retryFailed}
                    disabled={isUploading}
                    className="flex-1"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry failed
                  </Button>
                )}
                {isComplete && (
                  <Button
                    variant="outline"
                    onClick={clearCompleted}
                    className="flex-1"
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Clear completed
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={handleClearAll}
                  disabled={isUploading}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear all
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
