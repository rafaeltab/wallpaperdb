import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UploadActionButtons } from '@/components/upload/upload-action-buttons';

function renderActionButtons(overrides: Partial<Parameters<typeof UploadActionButtons>[0]> = {}) {
  const defaultProps = {
    isRunning: false,
    isPaused: false,
    isStopped: false,
    hasFailures: false,
    isComplete: false,
    onStopQueue: vi.fn(),
    onResumeQueue: vi.fn(),
    onClearAll: vi.fn(),
    onRetryFailed: vi.fn(),
    onClearCompleted: vi.fn(),
  };
  return render(<UploadActionButtons {...defaultProps} {...overrides} />);
}

describe('UploadActionButtons', () => {
  describe('when queue is running', () => {
    it('shows Stop uploading button', () => {
      renderActionButtons({ isRunning: true });

      expect(screen.getByText('Stop uploading')).toBeInTheDocument();
    });

    it('does not show Clear all button', () => {
      renderActionButtons({ isRunning: true });

      expect(screen.queryByText('Clear all')).not.toBeInTheDocument();
    });
  });

  describe('when queue is paused', () => {
    it('shows Stop uploading button', () => {
      renderActionButtons({ isPaused: true });

      expect(screen.getByText('Stop uploading')).toBeInTheDocument();
    });

    it('does not show Clear all button', () => {
      renderActionButtons({ isPaused: true });

      expect(screen.queryByText('Clear all')).not.toBeInTheDocument();
    });
  });

  describe('when queue is stopped', () => {
    it('shows Resume uploading button', () => {
      renderActionButtons({ isStopped: true });

      expect(screen.getByText('Resume uploading')).toBeInTheDocument();
    });

    it('shows Clear all button', () => {
      renderActionButtons({ isStopped: true });

      expect(screen.getByText('Clear all')).toBeInTheDocument();
    });

    it('does not show Stop uploading button', () => {
      renderActionButtons({ isStopped: true });

      expect(screen.queryByText('Stop uploading')).not.toBeInTheDocument();
    });
  });

  describe('button click handlers', () => {
    it('calls onStopQueue when Stop uploading is clicked', () => {
      const onStopQueue = vi.fn();
      renderActionButtons({ isRunning: true, onStopQueue });

      fireEvent.click(screen.getByText('Stop uploading'));

      expect(onStopQueue).toHaveBeenCalledTimes(1);
    });

    it('calls onResumeQueue when Resume uploading is clicked', () => {
      const onResumeQueue = vi.fn();
      renderActionButtons({ isStopped: true, onResumeQueue });

      fireEvent.click(screen.getByText('Resume uploading'));

      expect(onResumeQueue).toHaveBeenCalledTimes(1);
    });

    it('calls onClearAll when Clear all is clicked while stopped', () => {
      const onClearAll = vi.fn();
      renderActionButtons({ isStopped: true, onClearAll });

      fireEvent.click(screen.getByText('Clear all'));

      expect(onClearAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('when queue is idle/complete', () => {
    it('shows Clear all button when complete', () => {
      renderActionButtons({ isComplete: true });

      expect(screen.getByText('Clear all')).toBeInTheDocument();
    });

    it('does not show Stop uploading button', () => {
      renderActionButtons({ isComplete: true });

      expect(screen.queryByText('Stop uploading')).not.toBeInTheDocument();
    });

    it('does not show Resume uploading button', () => {
      renderActionButtons({ isComplete: true });

      expect(screen.queryByText('Resume uploading')).not.toBeInTheDocument();
    });
  });

  describe('with failures', () => {
    it('shows Retry failed button disabled when running with failures', () => {
      renderActionButtons({ isRunning: true, hasFailures: true });

      const button = screen.getByText('Retry failed').closest('button');
      expect(button).toBeDisabled();
    });

    it('shows Retry failed button enabled when stopped with failures', () => {
      renderActionButtons({ isStopped: true, hasFailures: true });

      const button = screen.getByText('Retry failed').closest('button');
      expect(button).not.toBeDisabled();
    });

    it('calls onRetryFailed when Retry failed is clicked', () => {
      const onRetryFailed = vi.fn();
      renderActionButtons({ hasFailures: true, onRetryFailed });

      fireEvent.click(screen.getByText('Retry failed'));

      expect(onRetryFailed).toHaveBeenCalledTimes(1);
    });

    it('does not show Retry failed when no failures', () => {
      renderActionButtons({ hasFailures: false });

      expect(screen.queryByText('Retry failed')).not.toBeInTheDocument();
    });
  });
});