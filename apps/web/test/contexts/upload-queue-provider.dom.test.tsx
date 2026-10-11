import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UploadQueueProvider } from '@/contexts/upload-queue-context';
import { UploadPage } from '@/routes/upload';

vi.mock('@/components/upload-auth-gate', () => ({
  UploadAuthGate: ({ children }: { children: ReactNode }) => children,
}));

const response = {
  wallpaperId: 'wp-1',
  userId: 'u-1',
  uploadState: 'processing',
  fileType: 'image',
  mimeType: 'image/jpeg',
  fileSizeBytes: 10,
  width: 10,
  height: 10,
  aspectRatio: 1,
  uploadedAt: '2026-10-03T00:00:00Z',
};

function setup() {
  const requests: {
    resolve: (response: Response) => void;
    signal: AbortSignal | null | undefined;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    (_input: unknown, options: RequestInit) =>
      new Promise<Response>((resolve) => {
        requests.push({ resolve, signal: options.signal });
      })
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <UploadQueueProvider>
          <UploadPage />
        </UploadQueueProvider>
      </QueryClientProvider>
    </StrictMode>
  );
  return { requests, ...rendered, user: userEvent.setup() };
}

async function finish(
  request: ReturnType<typeof setup>['requests'][number],
  status = 200,
  body = response
) {
  await act(async () => {
    request.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    );
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('upload queue React connection', () => {
  it('connects selection, stop/resume, progress and clear controls to the real workflow', async () => {
    const { user, requests } = setup();
    await user.upload(screen.getByTestId('file-input'), [
      new File(['a'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ]);
    await waitFor(() => expect(requests).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Stop uploading' }));
    await finish(requests[0]);
    expect(screen.getByTestId('upload-progress-status')).toHaveTextContent('Stopped');
    expect(screen.getByTestId('upload-success-count')).toHaveTextContent('1 uploaded');
    expect(screen.getByTestId('upload-progress-percent')).toHaveTextContent('50%');
    await user.click(screen.getByRole('button', { name: 'Resume uploading' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    await finish(requests[1]);
    expect(screen.getByTestId('upload-progress-status')).toHaveTextContent('Upload complete');
    expect(screen.getByTestId('upload-progress-percent')).toHaveTextContent('100%');
    await user.click(screen.getByRole('button', { name: 'Clear completed' }));
    expect(screen.queryByTestId('upload-file-list')).not.toBeInTheDocument();
  });

  it('shows errors and connects manual retry', async () => {
    const { user, requests } = setup();
    await user.upload(
      screen.getByTestId('file-input'),
      new File(['a'], 'a.jpg', { type: 'image/jpeg' })
    );
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => {
      requests[0].resolve(
        new Response(JSON.stringify({ detail: 'Service unavailable' }), { status: 503 })
      );
    });
    expect(await screen.findByText('Service unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry failed' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(screen.queryByText('Service unavailable')).not.toBeInTheDocument();
    await finish(requests[1]);
    expect(screen.getByTestId('upload-success-count')).toHaveTextContent('1 uploaded');
  });

  it('aborts active transport work on clear and on unmount', async () => {
    const { user, requests, unmount } = setup();
    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByTestId('file-input'), file);
    await waitFor(() => expect(requests).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Stop uploading' }));
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(requests[0].signal?.aborted).toBe(true);
    await finish(requests[0]);
    expect(screen.queryByTestId('upload-file-list')).not.toBeInTheDocument();
    await user.upload(screen.getByTestId('file-input'), file);
    await waitFor(() => expect(requests).toHaveLength(2));
    unmount();
    expect(requests[1].signal?.aborted).toBe(true);
  });
});

describe('upload queue browser clock connection', () => {
  it('shows a cooldown and uses the remaining delay after stop and resume', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { requests } = setup();
    await act(async () => {
      fireEvent.change(screen.getByTestId('file-input'), {
        target: { files: [new File(['a'], 'a.jpg', { type: 'image/jpeg' })] },
      });
    });
    expect(requests).toHaveLength(1);
    await act(async () => {
      requests[0].resolve(
        new Response(JSON.stringify({ detail: 'Slow down' }), {
          status: 429,
          headers: { 'Retry-After': '5' },
        })
      );
    });
    expect(screen.getByTestId('upload-progress-status')).toHaveTextContent('Paused');
    expect(screen.getByText('Slow down')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop uploading' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resume uploading' }));
    expect(screen.getByTestId('upload-progress-status')).toHaveTextContent('Paused');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(requests).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(requests).toHaveLength(2);
    expect(screen.queryByText('Slow down')).not.toBeInTheDocument();
    await finish(requests[1]);
    expect(screen.getByTestId('upload-progress-status')).toHaveTextContent('Upload complete');
  });
});
