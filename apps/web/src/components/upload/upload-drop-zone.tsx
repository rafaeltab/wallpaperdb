import { Upload } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface UploadDropZoneProps {
  onFilesSelected: (files: File[]) => void;
  maxFiles?: number;
  disabled?: boolean;
  label?: string;
  description?: string;
  className?: string;
}

export function UploadDropZone({
  onFilesSelected,
  maxFiles,
  disabled = false,
  label,
  description = 'Still JPEG, PNG, and WebP images. Up to 50 MiB, 100,000,000 pixels total, and 20,000 pixels per axis.',
  className,
}: UploadDropZoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [rejectionMessage, setRejectionMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;

      const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
      const maxImageSize = 50 * 1024 * 1024;
      const selectedFiles = Array.from(fileList);
      const hasUnsupportedType = selectedFiles.some((file) => !supportedTypes.has(file.type));
      const hasOversizedImage = selectedFiles.some(
        (file) => supportedTypes.has(file.type) && file.size > maxImageSize
      );
      setRejectionMessage(
        [
          hasUnsupportedType && 'Only JPEG, PNG, and WebP images are supported.',
          hasOversizedImage && 'Images must be 50 MiB or smaller.',
        ]
          .filter(Boolean)
          .join(' ') || null
      );

      let files = selectedFiles.filter(
        (file) => supportedTypes.has(file.type) && file.size <= maxImageSize
      );

      // Apply maxFiles limit if specified
      if (maxFiles && files.length > maxFiles) {
        files = files.slice(0, maxFiles);
      }

      if (files.length > 0) onFilesSelected(files);
    },
    [maxFiles, onFilesSelected]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Reset input value to allow selecting the same files again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [handleFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragActive(false);

      if (disabled) return;
      handleFiles(e.dataTransfer.files);
    },
    [disabled, handleFiles]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) {
        setIsDragActive(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
  }, []);

  const handleClick = useCallback(() => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  }, [disabled]);

  return (
    <>
      <button
        type="button"
        data-testid="drop-zone"
        disabled={disabled}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        className={cn(
          'relative border-2 border-dashed rounded-lg p-8 transition-colors cursor-pointer w-full',
          'hover:border-primary/50 hover:bg-muted/50',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
          isDragActive && 'border-primary bg-primary/5',
          disabled && 'pointer-events-none opacity-50',
          className
        )}
      >
        <input
          ref={fileInputRef}
          data-testid="file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleInputChange}
          disabled={disabled}
          className="sr-only"
        />
        <div className="flex flex-col items-center gap-2 text-center">
          <Upload className="h-10 w-10 text-muted-foreground" />
          <div>
            {label ? (
              <p className="text-sm font-medium">{label}</p>
            ) : (
              <p className="text-sm font-medium">
                {isDragActive ? 'Drop files here' : 'Click to upload or drag and drop'}
              </p>
            )}
            {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
          </div>
        </div>
      </button>
      {rejectionMessage && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {rejectionMessage}
        </p>
      )}
    </>
  );
}
