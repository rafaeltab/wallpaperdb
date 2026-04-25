import { ProblemDetailsError } from '@wallpaperdb/core/errors';

export class ColorExtractionError extends ProblemDetailsError {
  readonly type = 'color-extraction-failed';
  readonly title = 'Color Extraction Failed';
  readonly status = 500;
  readonly instance = '/color-extractor';

  constructor(wallpaperId: string, reason: string) {
    super(`Failed to extract colors for wallpaper ${wallpaperId}: ${reason}`);
  }
}
