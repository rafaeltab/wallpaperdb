import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadQueueToast } from './upload-queue-toast';
import { useUploadQueue } from '@/contexts/upload-queue-context';

const AUTO_DISMISS_DELAY = 5000; // 5 seconds

export function UploadQueueToastManager() {
  const { state, counts, progress, clearCompleted, retryFailed, cancelAll } = useUploadQueue();
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(false);
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasFiles = state.files.length > 0;
  const isUploading = counts.uploading > 0 || counts.pending > 0;
  const isComplete = hasFiles && !isUploading && !state.isPaused;
  const hasFailuresOrDuplicates = counts.failed > 0 || counts.duplicate > 0;

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    // Clear completed files after animation
    setTimeout(() => {
      clearCompleted();
      // If all files were completed, also cancel to reset state fully
      if (!state.files.some((f) => f.status === 'failed' || f.status === 'pending')) {
        cancelAll();
      }
    }, 300);
  }, [clearCompleted, cancelAll, state.files]);

  // Show toast when files are added
  useEffect(() => {
    if (hasFiles) {
      setIsVisible(true);
    }
  }, [hasFiles]);

  // Auto-dismiss when complete and no failures/duplicates
  useEffect(() => {
    if (autoDismissTimerRef.current) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }

    if (isComplete && !hasFailuresOrDuplicates) {
      autoDismissTimerRef.current = setTimeout(() => {
        handleDismiss();
      }, AUTO_DISMISS_DELAY);
    }

    return () => {
      if (autoDismissTimerRef.current) {
        clearTimeout(autoDismissTimerRef.current);
      }
    };
  }, [isComplete, hasFailuresOrDuplicates, handleDismiss]);

  const handleNavigateToUpload = () => {
    router.navigate({ to: '/upload' });
  };

  if (!isVisible || !hasFiles) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-5 duration-300">
      <UploadQueueToast
        files={state.files}
        counts={counts}
        progress={progress}
        isPaused={state.isPaused}
        pausedUntil={state.pausedUntil}
        onRetryFailed={retryFailed}
        onClearCompleted={handleDismiss}
        onNavigateToUpload={handleNavigateToUpload}
      />
    </div>
  );
}
