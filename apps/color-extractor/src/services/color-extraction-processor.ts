import { inject, injectable } from 'tsyringe';
import { MinioHistogramProvider } from './minio-histogram-provider.js';
import { EventsService } from './events.service.js';
import type { WallpaperUploadedEvent } from '@wallpaperdb/events/schemas';

@injectable()
export class ColorExtractionProcessor {
  constructor(
    @inject(MinioHistogramProvider) private readonly histogramProvider: MinioHistogramProvider,
    @inject(EventsService) private readonly events: EventsService
  ) {}

  async extractColors(wallpaper: WallpaperUploadedEvent['wallpaper']): Promise<void> {
    const histogram = await this.histogramProvider.extractHistogram(
      wallpaper.storageBucket,
      wallpaper.storageKey
    );

    await this.events.publishColorsExtracted(wallpaper.id, histogram, 'hsv');
  }
}
