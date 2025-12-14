import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UploadQueueToast } from '@/components/upload/upload-queue-toast';
import type { QueuedFile } from '@/contexts/upload-queue-context';

function createMockFile(name = 'test.jpg'): File {
  return new File(['test'], name, { type: 'image/jpeg' });
}

function createQueuedFile(
  id: string,
  status: QueuedFile['status'],
  name = 'test.jpg'
): QueuedFile {
  return {
    id,
    file: createMockFile(name),
    status,
  };
}

describe('UploadQueueToast', () => {
  it('shows uploading header when files are uploading', () => {
    const files: QueuedFile[] = [
      createQueuedFile('1', 'uploading'),
      createQueuedFile('2', 'pending'),
      createQueuedFile('3', 'success'),
    ];

    render(
      <UploadQueueToast
        files={files}
        counts={{ total: 3, pending: 1, uploading: 1, success: 1, failed: 0, duplicate: 0 }}
        progress={33}
        isPaused={false}
        pausedUntil={null}
        onRetryFailed={vi.fn()}
        onClearCompleted={vi.fn()}
        onNavigateToUpload={vi.fn()}
      />
    );

    expect(screen.getByText(/Uploading 1\/3/i)).toBeInTheDocument();
  });

  it('shows paused header with countdown when paused', () => {
    const files: QueuedFile[] = [createQueuedFile('1', 'pending')];
    const pausedUntil = Date.now() + 45000; // 45 seconds from now

    render(
      <UploadQueueToast
        files={files}
        counts={{ total: 1, pending: 1, uploading: 0, success: 0, failed: 0, duplicate: 0 }}
        progress={0}
        isPaused={true}
        pausedUntil={pausedUntil}
        onRetryFailed={vi.fn()}
        onClearCompleted={vi.fn()}
        onNavigateToUpload={vi.fn()}
      />
    );

    expect(screen.getByText(/Paused/i)).toBeInTheDocument();
  });

  it('shows complete header when all done', () => {
    const files: QueuedFile[] = [
      createQueuedFile('1', 'success'),
      createQueuedFile('2', 'success'),
    ];

    render(
      <UploadQueueToast
        files={files}
        counts={{ total: 2, pending: 0, uploading: 0, success: 2, failed: 0, duplicate: 0 }}
        progress={100}
        isPaused={false}
        pausedUntil={null}
        onRetryFailed={vi.fn()}
        onClearCompleted={vi.fn()}
        onNavigateToUpload={vi.fn()}
      />
    );

    expect(screen.getByText(/Upload complete/i)).toBeInTheDocument();
  });

  it('shows progress bar with correct value', () => {
    const files: QueuedFile[] = [
      createQueuedFile('1', 'success'),
      createQueuedFile('2', 'uploading'),
    ];

    render(
      <UploadQueueToast
        files={files}
        counts={{ total: 2, pending: 0, uploading: 1, success: 1, failed: 0, duplicate: 0 }}
        progress={50}
        isPaused={false}
        pausedUntil={null}
        onRetryFailed={vi.fn()}
        onClearCompleted={vi.fn()}
        onNavigateToUpload={vi.fn()}
      />
    );

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '50');
  });

  it('shows summary badges for each file status', () => {
    const files: QueuedFile[] = [
      createQueuedFile('1', 'success'),
      createQueuedFile('2', 'success'),
      createQueuedFile('3', 'duplicate'),
      createQueuedFile('4', 'failed'),
    ];

    render(
      <UploadQueueToast
        files={files}
        counts={{ total: 4, pending: 0, uploading: 0, success: 2, failed: 1, duplicate: 1 }}
        progress={100}
        isPaused={false}
        pausedUntil={null}
        onRetryFailed={vi.fn()}
        onClearCompleted={vi.fn()}
        onNavigateToUpload={vi.fn()}
      />
    );

    expect(screen.getByText(/2 uploaded/i)).toBeInTheDocument();
    expect(screen.getByText(/1 duplicate/i)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/i)).toBeInTheDocument();
  });

  it('expands to show file list when expanded', () => {
    const files: QueuedFile[] = [
      createQueuedFile('1', 'success', 'photo1.jpg'),
      createQueuedFile('2', 'failed', 'photo2.jpg'),
    ];

    render(
      <UploadQueueToast
        files={files}
        counts={{ total: 2, pending: 0, uploading: 0, success: 1, failed: 1, duplicate: 0 }}
        progress={100}
        isPaused={false}
        pausedUntil={null}
        onRetryFailed={vi.fn()}
        onClearCompleted={vi.fn()}
        onNavigateToUpload={vi.fn()}
      />
    );

    // Click expand button
    const expandButton = screen.getByTestId('expand-button');
    fireEvent.click(expandButton);

    // Should show file names
    expect(screen.getByText('photo1.jpg')).toBeInTheDocument();
    expect(screen.getByText('photo2.jpg')).toBeInTheDocument();
  });

  it('calls navigation when toast clicked', () => {
    const onNavigateToUpload = vi.fn();
    const files: QueuedFile[] = [createQueuedFile('1', 'uploading')];

    render(
      <UploadQueueToast
        files={files}
        counts={{ total: 1, pending: 0, uploading: 1, success: 0, failed: 0, duplicate: 0 }}
        progress={0}
        isPaused={false}
        pausedUntil={null}
        onRetryFailed={vi.fn()}
        onClearCompleted={vi.fn()}
        onNavigateToUpload={onNavigateToUpload}
      />
    );

    const toast = screen.getByTestId('upload-queue-toast');
    fireEvent.click(toast);

    expect(onNavigateToUpload).toHaveBeenCalledTimes(1);
  });

  it('shows retry button when there are failed files', () => {
    const onRetryFailed = vi.fn();
    const files: QueuedFile[] = [createQueuedFile('1', 'failed')];

    render(
      <UploadQueueToast
        files={files}
        counts={{ total: 1, pending: 0, uploading: 0, success: 0, failed: 1, duplicate: 0 }}
        progress={100}
        isPaused={false}
        pausedUntil={null}
        onRetryFailed={onRetryFailed}
        onClearCompleted={vi.fn()}
        onNavigateToUpload={vi.fn()}
      />
    );

    // Find the text that contains 'Retry' within a button element
    const retryText = screen.getByText(/Retry failed/i);
    const retryButton = retryText.closest('button');
    expect(retryButton).not.toBeNull();
    fireEvent.click(retryButton!);

    expect(onRetryFailed).toHaveBeenCalledTimes(1);
  });

  it('shows dismiss button when upload is complete', () => {
    const onClearCompleted = vi.fn();
    const files: QueuedFile[] = [createQueuedFile('1', 'success')];

    render(
      <UploadQueueToast
        files={files}
        counts={{ total: 1, pending: 0, uploading: 0, success: 1, failed: 0, duplicate: 0 }}
        progress={100}
        isPaused={false}
        pausedUntil={null}
        onRetryFailed={vi.fn()}
        onClearCompleted={onClearCompleted}
        onNavigateToUpload={vi.fn()}
      />
    );

    // Find the text that contains 'Dismiss' within a button element
    const dismissText = screen.getByText(/Dismiss/i);
    const dismissButton = dismissText.closest('button');
    expect(dismissButton).not.toBeNull();
    fireEvent.click(dismissButton!);

    expect(onClearCompleted).toHaveBeenCalledTimes(1);
  });
});
