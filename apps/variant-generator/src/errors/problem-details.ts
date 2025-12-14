import { ProblemDetailsError } from '@wallpaperdb/core/errors';

/**
 * Error thrown when variant generation fails.
 */
export class VariantGenerationError extends ProblemDetailsError {
  readonly type = 'variant-generation-failed';
  readonly title = 'Variant Generation Failed';
  readonly status = 500;
  readonly instance = '/variant-generator';

  constructor(wallpaperId: string, reason: string) {
    super(`Failed to generate variant for wallpaper ${wallpaperId}: ${reason}`);
  }
}

/**
 * Error thrown when the original wallpaper cannot be found.
 */
export class OriginalNotFoundError extends ProblemDetailsError {
  readonly type = 'original-not-found';
  readonly title = 'Original Wallpaper Not Found';
  readonly status = 404;
  readonly instance = '/variant-generator';

  constructor(wallpaperId: string, storageKey: string) {
    super(`Original wallpaper not found: ${wallpaperId} at ${storageKey}`);
  }
}

/**
 * Error thrown when the aspect ratio is not supported.
 */
export class UnsupportedAspectRatioError extends ProblemDetailsError {
  readonly type = 'unsupported-aspect-ratio';
  readonly title = 'Unsupported Aspect Ratio';
  readonly status = 422;
  readonly instance = '/variant-generator';

  constructor(wallpaperId: string, width: number, height: number) {
    const aspectRatio = (width / height).toFixed(2);
    super(
      `Wallpaper ${wallpaperId} has aspect ratio ${aspectRatio} (${width}x${height}) which doesn't match any supported categories`
    );
  }
}
