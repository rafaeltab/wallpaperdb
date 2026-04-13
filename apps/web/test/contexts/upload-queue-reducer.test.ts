import { describe, expect, it } from 'vitest';
import {
  type UploadQueueAction,
  type UploadQueueState,
  MAX_FILES_PER_BATCH,
  uploadQueueReducer,
} from '@/contexts/upload-queue-context';

// Helper to create a mock file
function createMockFile(name = 'test.jpg', size = 1024): File {
  return new File(['test'], name, { type: 'image/jpeg' });
}

// Initial state for tests
function createInitialState(): UploadQueueState {
  return {
    files: [],
    isProcessing: false,
    isPaused: false,
    isStopped: false,
    pausedUntil: null,
  };
}

describe('uploadQueueReducer', () => {
  describe('ADD_FILES', () => {
    it('adds files with pending status', () => {
      const state = createInitialState();
      const files = [createMockFile('a.jpg'), createMockFile('b.jpg')];

      const newState = uploadQueueReducer(state, {
        type: 'ADD_FILES',
        payload: { files },
      });

      expect(newState.files).toHaveLength(2);
      expect(newState.files[0].status).toBe('pending');
      expect(newState.files[1].status).toBe('pending');
      expect(newState.files[0].file.name).toBe('a.jpg');
      expect(newState.files[1].file.name).toBe('b.jpg');
    });

    it('assigns unique IDs to each file', () => {
      const state = createInitialState();
      const files = [createMockFile('a.jpg'), createMockFile('b.jpg')];

      const newState = uploadQueueReducer(state, {
        type: 'ADD_FILES',
        payload: { files },
      });

      expect(newState.files[0].id).toBeDefined();
      expect(newState.files[1].id).toBeDefined();
      expect(newState.files[0].id).not.toBe(newState.files[1].id);
    });

    it('enforces MAX_FILES_PER_BATCH limit', () => {
      const state = createInitialState();
      // Create more files than the limit
      const files = Array.from({ length: MAX_FILES_PER_BATCH + 10 }, (_, i) =>
        createMockFile(`file${i}.jpg`)
      );

      const newState = uploadQueueReducer(state, {
        type: 'ADD_FILES',
        payload: { files },
      });

      expect(newState.files.length).toBe(MAX_FILES_PER_BATCH);
    });

    it('enforces MAX_FILES_PER_BATCH limit including existing files', () => {
      // Start with files already near the limit (MAX_FILES_PER_BATCH - 10)
      const existingCount = MAX_FILES_PER_BATCH - 10;
      const existingFiles = Array.from({ length: existingCount }, (_, i) => ({
        id: `existing-${i}`,
        file: createMockFile(`existing${i}.jpg`),
        status: 'pending' as const,
      }));

      const state: UploadQueueState = {
        ...createInitialState(),
        files: existingFiles,
      };

      // Try to add more than remaining capacity (30 files when only 10 spots remain)
      const newFiles = Array.from({ length: 30 }, (_, i) => createMockFile(`new${i}.jpg`));

      const newState = uploadQueueReducer(state, {
        type: 'ADD_FILES',
        payload: { files: newFiles },
      });

      // Should be capped at MAX_FILES_PER_BATCH
      expect(newState.files.length).toBe(MAX_FILES_PER_BATCH);
    });
  });

  describe('START_UPLOAD', () => {
    it('transitions file to uploading status', () => {
      const state: UploadQueueState = {
        ...createInitialState(),
        files: [
          { id: 'file-1', file: createMockFile(), status: 'pending' },
          { id: 'file-2', file: createMockFile(), status: 'pending' },
        ],
      };

      const newState = uploadQueueReducer(state, {
        type: 'START_UPLOAD',
        payload: { fileId: 'file-1' },
      });

      expect(newState.files[0].status).toBe('uploading');
      expect(newState.files[1].status).toBe('pending');
      expect(newState.isProcessing).toBe(true);
    });
  });

  describe('UPLOAD_SUCCESS', () => {
    it('marks file as success with response', () => {
      const state: UploadQueueState = {
        ...createInitialState(),
        isProcessing: true,
        files: [{ id: 'file-1', file: createMockFile(), status: 'uploading' }],
      };

      const mockResponse = {
        wallpaperId: 'wlpr_123',
        userId: 'user_1',
        uploadState: 'processing',
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSizeBytes: 1024,
        width: 1920,
        height: 1080,
        aspectRatio: 1.78,
        uploadedAt: new Date().toISOString(),
      };

      const newState = uploadQueueReducer(state, {
        type: 'UPLOAD_SUCCESS',
        payload: { fileId: 'file-1', response: mockResponse },
      });

      expect(newState.files[0].status).toBe('success');
      expect(newState.files[0].response).toEqual(mockResponse);
    });
  });

  describe('UPLOAD_FAILED', () => {
    it('marks file as failed with error', () => {
      const state: UploadQueueState = {
        ...createInitialState(),
        isProcessing: true,
        files: [{ id: 'file-1', file: createMockFile(), status: 'uploading' }],
      };

      const error = {
        type: 'server' as const,
        message: 'Internal server error',
      };

      const newState = uploadQueueReducer(state, {
        type: 'UPLOAD_FAILED',
        payload: { fileId: 'file-1', error },
      });

      expect(newState.files[0].status).toBe('failed');
      expect(newState.files[0].error).toEqual(error);
    });
  });

  describe('UPLOAD_DUPLICATE', () => {
    it('marks file as duplicate', () => {
      const state: UploadQueueState = {
        ...createInitialState(),
        isProcessing: true,
        files: [{ id: 'file-1', file: createMockFile(), status: 'uploading' }],
      };

      const mockResponse = {
        wallpaperId: 'wlpr_existing',
        userId: 'user_1',
        uploadState: 'completed',
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSizeBytes: 1024,
        width: 1920,
        height: 1080,
        aspectRatio: 1.78,
        uploadedAt: new Date().toISOString(),
      };

      const newState = uploadQueueReducer(state, {
        type: 'UPLOAD_DUPLICATE',
        payload: { fileId: 'file-1', response: mockResponse },
      });

      expect(newState.files[0].status).toBe('duplicate');
      expect(newState.files[0].response).toEqual(mockResponse);
    });
  });

  describe('PAUSE_QUEUE', () => {
    it('sets isPaused and pausedUntil', () => {
      const state: UploadQueueState = {
        ...createInitialState(),
        isProcessing: true,
      };

      const pausedUntil = Date.now() + 60000; // 60 seconds from now

      const newState = uploadQueueReducer(state, {
        type: 'PAUSE_QUEUE',
        payload: { pausedUntil },
      });

      expect(newState.isPaused).toBe(true);
      expect(newState.pausedUntil).toBe(pausedUntil);
    });
  });

  describe('RESUME_QUEUE', () => {
    it('clears pause state', () => {
      const state: UploadQueueState = {
        ...createInitialState(),
        isProcessing: true,
        isPaused: true,
        pausedUntil: Date.now() + 60000,
      };

      const newState = uploadQueueReducer(state, {
        type: 'RESUME_QUEUE',
        payload: { now: Date.now() },
      });

      expect(newState.isPaused).toBe(false);
      expect(newState.pausedUntil).toBe(null);
    });
  });

  describe('CLEAR_COMPLETED', () => {
    it('removes success and duplicate files', () => {
      const state: UploadQueueState = {
        ...createInitialState(),
        files: [
          { id: 'file-1', file: createMockFile('a.jpg'), status: 'success' },
          { id: 'file-2', file: createMockFile('b.jpg'), status: 'duplicate' },
          { id: 'file-3', file: createMockFile('c.jpg'), status: 'failed' },
          { id: 'file-4', file: createMockFile('d.jpg'), status: 'pending' },
        ],
      };

      const newState = uploadQueueReducer(state, {
        type: 'CLEAR_COMPLETED',
      });

      expect(newState.files).toHaveLength(2);
      expect(newState.files.map((f) => f.id)).toEqual(['file-3', 'file-4']);
    });
  });

  describe('RETRY_FAILED', () => {
    it('moves failed files back to pending', () => {
      const state: UploadQueueState = {
        ...createInitialState(),
        files: [
          {
            id: 'file-1',
            file: createMockFile('a.jpg'),
            status: 'failed',
            error: { type: 'server', message: 'Error' },
          },
          { id: 'file-2', file: createMockFile('b.jpg'), status: 'success' },
          {
            id: 'file-3',
            file: createMockFile('c.jpg'),
            status: 'failed',
            error: { type: 'network', message: 'Network error' },
          },
        ],
      };

      const newState = uploadQueueReducer(state, {
        type: 'RETRY_FAILED',
      });

      expect(newState.files[0].status).toBe('pending');
      expect(newState.files[0].error).toBeUndefined();
      expect(newState.files[1].status).toBe('success');
      expect(newState.files[2].status).toBe('pending');
      expect(newState.files[2].error).toBeUndefined();
    });
  });

  describe('CANCEL_ALL', () => {
    it('clears all files and resets state', () => {
      const state: UploadQueueState = {
        files: [
          { id: 'file-1', file: createMockFile('a.jpg'), status: 'uploading' },
          { id: 'file-2', file: createMockFile('b.jpg'), status: 'pending' },
        ],
        isProcessing: true,
        isPaused: false,
        isStopped: false,
        pausedUntil: null,
      };

      const newState = uploadQueueReducer(state, {
        type: 'CANCEL_ALL',
      });

      expect(newState.files).toHaveLength(0);
      expect(newState.isProcessing).toBe(false);
      expect(newState.isPaused).toBe(false);
      expect(newState.isStopped).toBe(false);
    });
  });

  describe('SET_PROCESSING', () => {
    it('sets isProcessing flag', () => {
      const state = createInitialState();

      const newState = uploadQueueReducer(state, {
        type: 'SET_PROCESSING',
        payload: { isProcessing: true },
      });

      expect(newState.isProcessing).toBe(true);
    });
  });

  describe('STOP_QUEUE', () => {
    it('transitions from running to stopped', () => {
      const state: UploadQueueState = {
        ...createInitialState(),
        isProcessing: true,
        files: [{ id: 'file-1', file: createMockFile(), status: 'uploading' }],
      };

      const newState = uploadQueueReducer(state, { type: 'STOP_QUEUE' });

      expect(newState.isStopped).toBe(true);
      expect(newState.isProcessing).toBe(true);
    });

    it('transitions from paused to stopped preserving pausedUntil', () => {
      const pausedUntil = Date.now() + 60000;
      const state: UploadQueueState = {
        ...createInitialState(),
        isProcessing: true,
        isPaused: true,
        pausedUntil,
        files: [
          {
            id: 'file-1',
            file: createMockFile(),
            status: 'failed',
            error: { type: 'rate_limit', message: 'Rate limited', retryAfter: 60 },
          },
        ],
      };

      const newState = uploadQueueReducer(state, { type: 'STOP_QUEUE' });

      expect(newState.isStopped).toBe(true);
      expect(newState.isPaused).toBe(false);
      expect(newState.pausedUntil).toBe(pausedUntil);
    });
  });

  describe('RESUME_QUEUE', () => {
    it('transitions from stopped to running when outside rate limit window', () => {
      const state: UploadQueueState = {
        ...createInitialState(),
        isProcessing: true,
        isStopped: true,
        isPaused: false,
        pausedUntil: null,
        files: [{ id: 'file-1', file: createMockFile(), status: 'pending' }],
      };

      const newState = uploadQueueReducer(state, {
        type: 'RESUME_QUEUE',
        payload: { now: Date.now() },
      });

      expect(newState.isStopped).toBe(false);
      expect(newState.isPaused).toBe(false);
      expect(newState.pausedUntil).toBe(null);
    });

    it('transitions from stopped to paused when inside rate limit window', () => {
      const now = Date.now();
      const pausedUntil = now + 30000;
      const state: UploadQueueState = {
        ...createInitialState(),
        isProcessing: true,
        isStopped: true,
        isPaused: false,
        pausedUntil,
        files: [{ id: 'file-1', file: createMockFile(), status: 'pending' }],
      };

      const newState = uploadQueueReducer(state, {
        type: 'RESUME_QUEUE',
        payload: { now },
      });

      expect(newState.isStopped).toBe(false);
      expect(newState.isPaused).toBe(true);
      expect(newState.pausedUntil).toBe(pausedUntil);
    });

    it('preserves existing pause behavior when not stopped', () => {
      const state: UploadQueueState = {
        ...createInitialState(),
        isProcessing: true,
        isPaused: true,
        pausedUntil: Date.now() + 60000,
      };

      const newState = uploadQueueReducer(state, {
        type: 'RESUME_QUEUE',
        payload: { now: Date.now() },
      });

      expect(newState.isPaused).toBe(false);
      expect(newState.pausedUntil).toBe(null);
      expect(newState.isStopped).toBe(false);
    });

    it('does not retry previously failed files on resume from stopped', () => {
      const state: UploadQueueState = {
        ...createInitialState(),
        isProcessing: true,
        isStopped: true,
        isPaused: false,
        pausedUntil: null,
        files: [
          { id: 'file-1', file: createMockFile('a.jpg'), status: 'pending' },
          {
            id: 'file-2',
            file: createMockFile('b.jpg'),
            status: 'failed',
            error: { type: 'server', message: 'Error' },
          },
          { id: 'file-3', file: createMockFile('c.jpg'), status: 'success' },
        ],
      };

      const newState = uploadQueueReducer(state, {
        type: 'RESUME_QUEUE',
        payload: { now: Date.now() },
      });

      expect(newState.files[0].status).toBe('pending');
      expect(newState.files[1].status).toBe('failed');
      expect(newState.files[2].status).toBe('success');
    });
  });

  describe('auto-reset to idle from stopped', () => {
    it('resets to idle when last uploading file succeeds in stopped state', () => {
      const state: UploadQueueState = {
        files: [
          { id: 'file-1', file: createMockFile('a.jpg'), status: 'failed', error: { type: 'server', message: 'Error' } },
          { id: 'file-2', file: createMockFile('b.jpg'), status: 'uploading' },
        ],
        isProcessing: true,
        isPaused: false,
        isStopped: true,
        pausedUntil: null,
      };

      const newState = uploadQueueReducer(state, {
        type: 'UPLOAD_SUCCESS',
        payload: { fileId: 'file-2', response: { wallpaperId: 'wlpr_1', userId: 'u1', uploadState: 'processing', fileType: 'image', mimeType: 'image/jpeg', fileSizeBytes: 1024, width: 1920, height: 1080, aspectRatio: 1.78, uploadedAt: '2024-01-01T00:00:00Z' } },
      });

      expect(newState.files.length).toBe(0);
      expect(newState.isProcessing).toBe(false);
      expect(newState.isStopped).toBe(false);
      expect(newState.isPaused).toBe(false);
      expect(newState.pausedUntil).toBe(null);
    });

    it('resets to idle when last uploading file fails in stopped state', () => {
      const state: UploadQueueState = {
        files: [
          { id: 'file-1', file: createMockFile('a.jpg'), status: 'success' },
          { id: 'file-2', file: createMockFile('b.jpg'), status: 'uploading' },
        ],
        isProcessing: true,
        isPaused: false,
        isStopped: true,
        pausedUntil: null,
      };

      const newState = uploadQueueReducer(state, {
        type: 'UPLOAD_FAILED',
        payload: { fileId: 'file-2', error: { type: 'server', message: 'Error' } },
      });

      expect(newState.files.length).toBe(0);
      expect(newState.isProcessing).toBe(false);
      expect(newState.isStopped).toBe(false);
    });

    it('does not auto-reset when pending files remain in stopped state', () => {
      const state: UploadQueueState = {
        files: [
          { id: 'file-1', file: createMockFile('a.jpg'), status: 'pending' },
          { id: 'file-2', file: createMockFile('b.jpg'), status: 'uploading' },
        ],
        isProcessing: true,
        isPaused: false,
        isStopped: true,
        pausedUntil: null,
      };

      const newState = uploadQueueReducer(state, {
        type: 'UPLOAD_SUCCESS',
        payload: { fileId: 'file-2', response: { wallpaperId: 'wlpr_1', userId: 'u1', uploadState: 'processing', fileType: 'image', mimeType: 'image/jpeg', fileSizeBytes: 1024, width: 1920, height: 1080, aspectRatio: 1.78, uploadedAt: '2024-01-01T00:00:00Z' } },
      });

      expect(newState.files.length).toBe(2);
      expect(newState.isStopped).toBe(true);
      expect(newState.files[0].status).toBe('pending');
      expect(newState.files[1].status).toBe('success');
    });
  });

  describe('pausedUntil persistence across STOP_QUEUE and RESUME_QUEUE', () => {
    it('preserves pausedUntil across stop and resume cycle inside rate limit window', () => {
      const now = Date.now();
      const pausedUntil = now + 30000;

      const stoppedState = uploadQueueReducer(
        {
          ...createInitialState(),
          isProcessing: true,
          isPaused: true,
          pausedUntil,
          files: [
            {
              id: 'file-1',
              file: createMockFile(),
              status: 'failed',
              error: { type: 'rate_limit', message: 'Rate limited', retryAfter: 30 },
            },
          ],
        },
        { type: 'STOP_QUEUE' }
      );

      expect(stoppedState.isStopped).toBe(true);
      expect(stoppedState.pausedUntil).toBe(pausedUntil);

      const resumedState = uploadQueueReducer(stoppedState, {
        type: 'RESUME_QUEUE',
        payload: { now },
      });

      expect(resumedState.isStopped).toBe(false);
      expect(resumedState.isPaused).toBe(true);
      expect(resumedState.pausedUntil).toBe(pausedUntil);
    });

    it('clears pausedUntil when resuming outside rate limit window', () => {
      const now = Date.now();
      const pausedUntil = now - 1000;

      const stoppedState = uploadQueueReducer(
        {
          ...createInitialState(),
          isProcessing: true,
          isStopped: true,
          isPaused: false,
          pausedUntil,
          files: [{ id: 'file-1', file: createMockFile(), status: 'pending' }],
        },
        { type: 'RESUME_QUEUE', payload: { now } }
      );

      expect(stoppedState.isPaused).toBe(false);
      expect(stoppedState.pausedUntil).toBe(null);
    });
  });
});
