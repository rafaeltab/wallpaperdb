import type { WallpaperUploadedEvent } from '@wallpaperdb/events/schemas';
import { inject, injectable } from 'tsyringe';
import {
  COLORS_EXTRACTED_PUBLISHER,
  HISTOGRAM_PROVIDER,
  type ColorsExtractedPublisher,
  type ColorExtractionUseCase,
  type ImageHistogramProvider,
} from './ports.js';

@injectable()
export class ColorExtractionProcessor implements ColorExtractionUseCase {
  constructor(
    @inject(HISTOGRAM_PROVIDER) private readonly histogramProvider: ImageHistogramProvider,
    @inject(COLORS_EXTRACTED_PUBLISHER) private readonly events: ColorsExtractedPublisher
  ) {}

  async extractColors(wallpaper: WallpaperUploadedEvent['wallpaper']): Promise<void> {
    const histogram = await this.histogramProvider.extractHistogram(
      wallpaper.storageBucket,
      wallpaper.storageKey
    );

    await this.events.publishColorsExtracted(wallpaper.id, histogram, 'hsv');
  }
}
