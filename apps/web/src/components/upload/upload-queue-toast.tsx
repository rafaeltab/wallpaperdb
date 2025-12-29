import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { QueuedFile } from '@/contexts/upload-queue-context';
import { cn } from '@/lib/utils';

export interface UploadQueueToastProps {
  files: QueuedFile[];
  counts: {
    total: number;
    pending: number;
    uploading: number;
    success: number;
    failed: number;
    duplicate: number;
  };
  progress: number;
  isPaused: boolean;
  pausedUntil: number | null;
  onRetryFailed: () => void;
  onClearCompleted: () => void;
  onNavigateToUpload: () => void;
}

function getStatusIcon(status: QueuedFile['status']) {
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

function formatTimeRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

export function UploadQueueToast({
  files,
  counts,
  progress,
  isPaused,
  pausedUntil,
  onRetryFailed,
  onClearCompleted,
  onNavigateToUpload,
}: UploadQueueToastProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);

  const isUploading = counts.uploading > 0 || counts.pending > 0;
  const isComplete = !isUploading && !isPaused;
  const hasFailures = counts.failed > 0;
  const completedCount = counts.success + counts.failed + counts.duplicate;

  // Update countdown timer
  useEffect(() => {
    if (!pausedUntil) {
      setTimeRemaining(null);
      return;
    }

    const updateRemaining = () => {
      const remaining = pausedUntil - Date.now();
      if (remaining <= 0) {
        setTimeRemaining(null);
      } else {
        setTimeRemaining(formatTimeRemaining(remaining));
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);

    return () => clearInterval(interval);
  }, [pausedUntil]);

  // Determine header text
  let headerText = '';
  if (isPaused && timeRemaining) {
    headerText = `Paused (resuming in ${timeRemaining})`;
  } else if (isPaused) {
    headerText = 'Paused';
  } else if (isComplete) {
    headerText = 'Upload complete';
  } else {
    headerText = `Uploading ${completedCount}/${counts.total} files`;
  }

  const handleToastClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking on buttons
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    onNavigateToUpload();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onNavigateToUpload();
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: Interactive card containing buttons - can't use <button> as it would create invalid nested buttons
    <div
      data-testid="upload-queue-toast"
      role="button"
      tabIndex={0}
      onClick={handleToastClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'w-80 rounded-lg border bg-background p-4 shadow-lg cursor-pointer',
        'hover:border-primary/50 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-sm">{headerText}</span>
        <button
          type="button"
          data-testid="expand-button"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          className="p-1 hover:bg-muted rounded"
        >
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Progress bar */}
      <Progress
        value={progress}
        className="h-2 mb-3"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      />

      {/* Summary badges */}
      <div className="flex flex-wrap gap-2 mb-3">
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
      </div>

      {/* Expanded file list */}
      {isExpanded && (
        <div className="max-h-48 overflow-y-auto border-t pt-2 mb-3">
          <ul className="space-y-1">
            {files.map((file) => (
              <li key={file.id} className="flex items-center gap-2 text-sm">
                {getStatusIcon(file.status)}
                <span className="truncate flex-1">{file.file.name}</span>
                {file.error && (
                  <span className="text-xs text-destructive truncate max-w-[100px]">
                    {file.error.message}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {hasFailures && (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onRetryFailed();
            }}
            className="flex-1"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry failed
          </Button>
        )}
        {isComplete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onClearCompleted();
            }}
            className="flex-1"
          >
            <X className="h-3 w-3 mr-1" />
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}
