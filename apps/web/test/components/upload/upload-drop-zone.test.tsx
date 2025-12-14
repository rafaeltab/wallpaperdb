import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UploadDropZone } from '@/components/upload/upload-drop-zone';

function createMockFile(name = 'test.jpg', type = 'image/jpeg'): File {
  return new File(['test'], name, { type });
}

function createDataTransfer(files: File[]): DataTransfer {
  const dataTransfer = new DataTransfer();
  for (const file of files) {
    dataTransfer.items.add(file);
  }
  return dataTransfer;
}

describe('UploadDropZone', () => {
  it('renders drop zone UI', () => {
    render(<UploadDropZone onFilesSelected={vi.fn()} />);

    expect(screen.getByText(/click to upload/i)).toBeInTheDocument();
    expect(screen.getByText(/drag and drop/i)).toBeInTheDocument();
  });

  it('calls onFilesSelected when files selected via input', async () => {
    const onFilesSelected = vi.fn();
    render(<UploadDropZone onFilesSelected={onFilesSelected} />);

    const input = screen.getByTestId('file-input');
    const files = [createMockFile('a.jpg'), createMockFile('b.jpg')];

    fireEvent.change(input, { target: { files } });

    await waitFor(() => {
      expect(onFilesSelected).toHaveBeenCalledTimes(1);
      expect(onFilesSelected).toHaveBeenCalledWith(expect.arrayContaining([expect.any(File)]));
    });
  });

  it('calls onFilesSelected when files dropped', async () => {
    const onFilesSelected = vi.fn();
    render(<UploadDropZone onFilesSelected={onFilesSelected} />);

    const dropZone = screen.getByTestId('drop-zone');
    const files = [createMockFile('a.jpg')];
    const dataTransfer = createDataTransfer(files);

    fireEvent.drop(dropZone, { dataTransfer });

    await waitFor(() => {
      expect(onFilesSelected).toHaveBeenCalledTimes(1);
    });
  });

  it('respects maxFiles limit', async () => {
    const onFilesSelected = vi.fn();
    render(<UploadDropZone onFilesSelected={onFilesSelected} maxFiles={2} />);

    const input = screen.getByTestId('file-input');
    const files = [createMockFile('a.jpg'), createMockFile('b.jpg'), createMockFile('c.jpg')];

    fireEvent.change(input, { target: { files } });

    await waitFor(() => {
      expect(onFilesSelected).toHaveBeenCalledWith(
        expect.arrayContaining([expect.any(File), expect.any(File)])
      );
      // Should only have 2 files due to limit
      const calledFiles = onFilesSelected.mock.calls[0][0];
      expect(calledFiles.length).toBe(2);
    });
  });

  it('shows drag-active state during drag-over', () => {
    render(<UploadDropZone onFilesSelected={vi.fn()} />);

    const dropZone = screen.getByTestId('drop-zone');

    fireEvent.dragOver(dropZone);
    expect(dropZone).toHaveClass('border-primary');

    fireEvent.dragLeave(dropZone);
    expect(dropZone).not.toHaveClass('border-primary');
  });

  it('can be disabled', () => {
    render(<UploadDropZone onFilesSelected={vi.fn()} disabled />);

    const dropZone = screen.getByTestId('drop-zone');
    const input = screen.getByTestId('file-input');

    expect(dropZone).toHaveClass('pointer-events-none');
    expect(input).toBeDisabled();
  });

  it('accepts multiple files by default', () => {
    render(<UploadDropZone onFilesSelected={vi.fn()} />);

    const input = screen.getByTestId('file-input');
    expect(input).toHaveAttribute('multiple');
  });

  it('shows custom label when provided', () => {
    render(<UploadDropZone onFilesSelected={vi.fn()} label="Upload images" />);

    expect(screen.getByText('Upload images')).toBeInTheDocument();
  });

  it('shows file type restrictions', () => {
    render(<UploadDropZone onFilesSelected={vi.fn()} accept="image/*" />);

    const input = screen.getByTestId('file-input');
    expect(input).toHaveAttribute('accept', 'image/*');
  });
});
