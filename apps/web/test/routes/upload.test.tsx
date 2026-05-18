import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
}));

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/upload-auth-gate', () => ({
  UploadAuthGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useCountdown', () => ({
  useCountdown: vi.fn(() => null),
}));

vi.mock('@/contexts/upload-queue-context', () => ({
  MAX_FILES_PER_BATCH: 200,
  useUploadQueue: vi.fn(),
}));

import { useQueryClient } from '@tanstack/react-query';
import { useUploadQueue } from '@/contexts/upload-queue-context';
import { UploadPage } from '@/routes/upload';

describe('UploadPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useQueryClient as Mock).mockReturnValue({
      invalidateQueries: vi.fn(),
    });
  });

  it('exposes stable E2E selectors for the initial authenticated upload flow', () => {
    (useUploadQueue as Mock).mockReturnValue({
      state: {
        files: [
          {
            id: 'file-1',
            file: new File(['a'], 'fixture-a.png', { type: 'image/png' }),
            status: 'success',
          },
        ],
        isPaused: false,
        isStopped: false,
        pausedUntil: null,
      },
      counts: {
        total: 1,
        pending: 0,
        uploading: 0,
        success: 1,
        failed: 0,
        duplicate: 0,
      },
      progress: 100,
      addFiles: vi.fn(),
      clearCompleted: vi.fn(),
      retryFailed: vi.fn(),
      cancelAll: vi.fn(),
      stopQueue: vi.fn(),
      resumeQueue: vi.fn(),
    });

    render(<UploadPage />);

    expect(screen.getByTestId('upload-page')).toBeInTheDocument();
    expect(screen.getByTestId('drop-zone')).toBeInTheDocument();
    expect(screen.getByTestId('upload-progress-status')).toHaveTextContent('Upload complete');
    expect(screen.getByTestId('upload-progress-percent')).toHaveTextContent('100%');
    expect(screen.getByTestId('upload-progress-bar')).toBeInTheDocument();
    expect(screen.getByTestId('upload-status-summary')).toBeInTheDocument();
    expect(screen.getByTestId('upload-success-count')).toHaveTextContent('1 uploaded');
    expect(screen.getByTestId('upload-file-list')).toBeInTheDocument();
    expect(screen.getAllByTestId('upload-file-item')).toHaveLength(1);
    expect(screen.getByTestId('clear-completed-button')).toBeInTheDocument();
  });

  it('exposes the failed-status selector when upload failures are present', () => {
    (useUploadQueue as Mock).mockReturnValue({
      state: {
        files: [
          {
            id: 'file-1',
            file: new File(['a'], 'fixture-b.jpg', { type: 'image/jpeg' }),
            status: 'failed',
            error: { type: 'server', message: 'Upload failed' },
          },
        ],
        isPaused: false,
        isStopped: true,
        pausedUntil: null,
      },
      counts: {
        total: 1,
        pending: 0,
        uploading: 0,
        success: 0,
        failed: 1,
        duplicate: 0,
      },
      progress: 100,
      addFiles: vi.fn(),
      clearCompleted: vi.fn(),
      retryFailed: vi.fn(),
      cancelAll: vi.fn(),
      stopQueue: vi.fn(),
      resumeQueue: vi.fn(),
    });

    render(<UploadPage />);

    expect(screen.getByTestId('upload-failed-count')).toHaveTextContent('1 failed');
    expect(screen.getByTestId('retry-failed-button')).toBeInTheDocument();
  });
});
