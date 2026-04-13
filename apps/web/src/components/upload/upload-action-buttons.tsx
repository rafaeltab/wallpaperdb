import { Play, RefreshCw, Square, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UploadActionButtonsProps {
  isRunning: boolean;
  isPaused: boolean;
  isStopped: boolean;
  hasFailures: boolean;
  isComplete: boolean;
  onStopQueue: () => void;
  onResumeQueue: () => void;
  onClearAll: () => void;
  onRetryFailed: () => void;
  onClearCompleted: () => void;
}

export function UploadActionButtons({
  isRunning,
  isPaused,
  isStopped,
  hasFailures,
  isComplete,
  onStopQueue,
  onResumeQueue,
  onClearAll,
  onRetryFailed,
  onClearCompleted,
}: UploadActionButtonsProps) {
  const showStopButton = isRunning || isPaused;
  const showResumeButton = isStopped;
  const showClearAllButton = isStopped || (!isRunning && !isPaused);

  return (
    <div className="flex gap-2">
      {hasFailures && (
        <Button variant="outline" onClick={onRetryFailed} disabled={isRunning} className="flex-1">
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry failed
        </Button>
      )}
      {showStopButton && (
        <Button variant="ghost" onClick={onStopQueue} className="flex-1">
          <Square className="mr-2 h-4 w-4" />
          Stop uploading
        </Button>
      )}
      {showResumeButton && (
        <Button variant="outline" onClick={onResumeQueue} className="flex-1">
          <Play className="mr-2 h-4 w-4" />
          Resume uploading
        </Button>
      )}
      {showClearAllButton && !showStopButton && (
        <Button variant="ghost" onClick={onClearAll}>
          <Trash2 className="mr-2 h-4 w-4" />
          Clear all
        </Button>
      )}
      {isComplete && !isStopped && (
        <Button variant="outline" onClick={onClearCompleted} className="flex-1">
          <Check className="mr-2 h-4 w-4" />
          Clear completed
        </Button>
      )}
    </div>
  );
}
