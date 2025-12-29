import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { uploadWallpaperWithDetails } from '@/lib/api/ingestor';

// Maximum files per batch (configurable constant)
export const MAX_FILES_PER_BATCH = 200;

// Demo user ID (to be replaced with actual auth later)
const DEMO_USER_ID = 'user_demo_001';

// File status types
export type FileStatus = 'pending' | 'uploading' | 'success' | 'failed' | 'duplicate';

// Error types from the API
export type UploadErrorType = 'rate_limit' | 'validation' | 'server' | 'network';

export interface UploadError {
  type: UploadErrorType;
  message: string;
  retryAfter?: number;
}

export interface UploadResponse {
  wallpaperId: string;
  userId: string;
  uploadState: string;
  fileType: string;
  mimeType: string;
  fileSizeBytes: number;
  width: number;
  height: number;
  aspectRatio: number;
  uploadedAt: string;
}

// File entry in the queue
export interface QueuedFile {
  id: string;
  file: File;
  status: FileStatus;
  error?: UploadError;
  response?: UploadResponse;
}

// State shape
export interface UploadQueueState {
  files: QueuedFile[];
  isProcessing: boolean;
  isPaused: boolean;
  pausedUntil: number | null;
}

// Action types
export type UploadQueueAction =
  | { type: 'ADD_FILES'; payload: { files: File[] } }
  | { type: 'START_UPLOAD'; payload: { fileId: string } }
  | { type: 'UPLOAD_SUCCESS'; payload: { fileId: string; response: UploadResponse } }
  | { type: 'UPLOAD_FAILED'; payload: { fileId: string; error: UploadError } }
  | { type: 'UPLOAD_DUPLICATE'; payload: { fileId: string; response: UploadResponse } }
  | { type: 'PAUSE_QUEUE'; payload: { pausedUntil: number } }
  | { type: 'RESUME_QUEUE' }
  | { type: 'CLEAR_COMPLETED' }
  | { type: 'RETRY_FAILED' }
  | { type: 'CANCEL_ALL' }
  | { type: 'SET_PROCESSING'; payload: { isProcessing: boolean } };

// Generate unique ID for files
function generateFileId(): string {
  return `file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Initial state
const initialState: UploadQueueState = {
  files: [],
  isProcessing: false,
  isPaused: false,
  pausedUntil: null,
};

// Reducer function
export function uploadQueueReducer(
  state: UploadQueueState,
  action: UploadQueueAction
): UploadQueueState {
  switch (action.type) {
    case 'ADD_FILES': {
      const { files } = action.payload;
      const existingCount = state.files.length;
      const remainingCapacity = MAX_FILES_PER_BATCH - existingCount;
      const filesToAdd = files.slice(0, remainingCapacity);

      const newFiles: QueuedFile[] = filesToAdd.map((file) => ({
        id: generateFileId(),
        file,
        status: 'pending' as const,
      }));

      return {
        ...state,
        files: [...state.files, ...newFiles],
      };
    }

    case 'START_UPLOAD': {
      const { fileId } = action.payload;
      return {
        ...state,
        isProcessing: true,
        files: state.files.map((f) =>
          f.id === fileId ? { ...f, status: 'uploading' as const } : f
        ),
      };
    }

    case 'UPLOAD_SUCCESS': {
      const { fileId, response } = action.payload;
      return {
        ...state,
        files: state.files.map((f) =>
          f.id === fileId ? { ...f, status: 'success' as const, response } : f
        ),
      };
    }

    case 'UPLOAD_FAILED': {
      const { fileId, error } = action.payload;
      return {
        ...state,
        files: state.files.map((f) =>
          f.id === fileId ? { ...f, status: 'failed' as const, error } : f
        ),
      };
    }

    case 'UPLOAD_DUPLICATE': {
      const { fileId, response } = action.payload;
      return {
        ...state,
        files: state.files.map((f) =>
          f.id === fileId ? { ...f, status: 'duplicate' as const, response } : f
        ),
      };
    }

    case 'PAUSE_QUEUE': {
      const { pausedUntil } = action.payload;
      return {
        ...state,
        isPaused: true,
        pausedUntil,
      };
    }

    case 'RESUME_QUEUE': {
      return {
        ...state,
        isPaused: false,
        pausedUntil: null,
      };
    }

    case 'CLEAR_COMPLETED': {
      return {
        ...state,
        files: state.files.filter((f) => f.status !== 'success' && f.status !== 'duplicate'),
      };
    }

    case 'RETRY_FAILED': {
      return {
        ...state,
        files: state.files.map((f) =>
          f.status === 'failed' ? { ...f, status: 'pending' as const, error: undefined } : f
        ),
      };
    }

    case 'CANCEL_ALL': {
      return {
        ...initialState,
      };
    }

    case 'SET_PROCESSING': {
      const { isProcessing } = action.payload;
      return {
        ...state,
        isProcessing,
      };
    }

    default:
      return state;
  }
}

// Context types
interface UploadQueueContextValue {
  state: UploadQueueState;
  addFiles: (files: File[]) => void;
  clearCompleted: () => void;
  retryFailed: () => void;
  cancelAll: () => void;
  // Computed values
  counts: {
    total: number;
    pending: number;
    uploading: number;
    success: number;
    failed: number;
    duplicate: number;
  };
  progress: number;
}

const UploadQueueContext = createContext<UploadQueueContextValue | undefined>(undefined);

// Provider component
interface UploadQueueProviderProps {
  children: ReactNode;
}

export function UploadQueueProvider({ children }: UploadQueueProviderProps) {
  const [state, dispatch] = useReducer(uploadQueueReducer, initialState);
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Computed counts
  const counts = useMemo(() => {
    const result = {
      total: state.files.length,
      pending: 0,
      uploading: 0,
      success: 0,
      failed: 0,
      duplicate: 0,
    };

    for (const file of state.files) {
      result[file.status]++;
    }

    return result;
  }, [state.files]);

  // Progress percentage (0-100)
  const progress = useMemo(() => {
    if (counts.total === 0) return 0;
    const completed = counts.success + counts.failed + counts.duplicate;
    return Math.round((completed / counts.total) * 100);
  }, [counts]);

  // Actions
  const addFiles = useCallback((files: File[]) => {
    dispatch({ type: 'ADD_FILES', payload: { files } });
  }, []);

  const clearCompleted = useCallback(() => {
    dispatch({ type: 'CLEAR_COMPLETED' });
  }, []);

  const retryFailed = useCallback(() => {
    dispatch({ type: 'RETRY_FAILED' });
  }, []);

  const cancelAll = useCallback(() => {
    dispatch({ type: 'CANCEL_ALL' });
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }
  }, []);

  // Process the next pending file
  const processNextFile = useCallback(async () => {
    // Don't process if paused
    if (state.isPaused) return;

    // Find the next pending file
    const nextFile = state.files.find((f) => f.status === 'pending');
    if (!nextFile) {
      // No more pending files
      dispatch({ type: 'SET_PROCESSING', payload: { isProcessing: false } });
      return;
    }

    // Start upload
    dispatch({ type: 'START_UPLOAD', payload: { fileId: nextFile.id } });

    try {
      const result = await uploadWallpaperWithDetails(nextFile.file, DEMO_USER_ID);

      if (result.success && result.response) {
        if (result.isDuplicate) {
          dispatch({
            type: 'UPLOAD_DUPLICATE',
            payload: { fileId: nextFile.id, response: result.response },
          });
        } else {
          dispatch({
            type: 'UPLOAD_SUCCESS',
            payload: { fileId: nextFile.id, response: result.response },
          });
        }
      } else if (result.error) {
        if (result.error.type === 'rate_limit' && result.error.retryAfter) {
          // Pause queue on rate limit
          const pausedUntil = Date.now() + result.error.retryAfter * 1000;
          dispatch({ type: 'PAUSE_QUEUE', payload: { pausedUntil } });

          // Mark current file as failed (will be retried)
          dispatch({
            type: 'UPLOAD_FAILED',
            payload: { fileId: nextFile.id, error: result.error },
          });

          // Schedule resume
          resumeTimeoutRef.current = setTimeout(() => {
            dispatch({ type: 'RESUME_QUEUE' });
            dispatch({ type: 'RETRY_FAILED' });
          }, result.error.retryAfter * 1000);
        } else {
          dispatch({
            type: 'UPLOAD_FAILED',
            payload: { fileId: nextFile.id, error: result.error },
          });
        }
      }
    } catch (error) {
      dispatch({
        type: 'UPLOAD_FAILED',
        payload: {
          fileId: nextFile.id,
          error: {
            type: 'network',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      });
    }
  }, [state.files, state.isPaused]);

  // Auto-process pending files
  useEffect(() => {
    const hasPending = state.files.some((f) => f.status === 'pending');
    const hasUploading = state.files.some((f) => f.status === 'uploading');

    // Start processing if we have pending files and not currently uploading
    if (hasPending && !hasUploading && !state.isPaused) {
      processNextFile();
    }
  }, [state.files, state.isPaused, processNextFile]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
      }
    };
  }, []);

  const value: UploadQueueContextValue = {
    state,
    addFiles,
    clearCompleted,
    retryFailed,
    cancelAll,
    counts,
    progress,
  };

  return <UploadQueueContext.Provider value={value}>{children}</UploadQueueContext.Provider>;
}

// Hook to use the context
export function useUploadQueue() {
  const context = useContext(UploadQueueContext);
  if (!context) {
    throw new Error('useUploadQueue must be used within an UploadQueueProvider');
  }
  return context;
}
