import { Upload } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface UploadDropZoneProps {
  onFilesSelected: (files: File[]) => void;
  maxFiles?: number;
  accept?: string;
  disabled?: boolean;
  label?: string;
  description?: string;
  className?: string;
}

export function UploadDropZone({
  onFilesSelected,
  maxFiles,
  accept = 'image/*,video/*',
  disabled = false,
  label,
  description = 'Images up to 50MB, Videos up to 200MB',
  className,
}: UploadDropZoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;

      let files = Array.from(fileList);

      // Apply maxFiles limit if specified
      if (maxFiles && files.length > maxFiles) {
        files = files.slice(0, maxFiles);
      }

      onFilesSelected(files);
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
        e.preventDefault();
        fileInputRef.current?.click();
      }
    },
    [disabled]
  );

  return (
    <div
      data-testid="drop-zone"
      role="button"
      tabIndex={disabled ? -1 : 0}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'relative border-2 border-dashed rounded-lg p-8 transition-colors cursor-pointer',
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
        accept={accept}
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
    </div>
  );
}
