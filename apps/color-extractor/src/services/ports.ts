import type { WallpaperUploadedEvent } from '@wallpaperdb/events/schemas';

export interface ImageReader {
  read(bucket: string, key: string): Promise<Buffer>;
}

export interface ImageHistogramProvider {
  extractHistogram(bucket: string, key: string): Promise<number[]>;
}

export interface ColorsExtractedPublisher {
  publishColorsExtracted(
    wallpaperId: string,
    colorHistogram: number[],
    colorSpace: string
  ): Promise<void>;
}

export interface ColorExtractionUseCase {
  extractColors(wallpaper: WallpaperUploadedEvent['wallpaper']): Promise<void>;
}

export const IMAGE_READER = Symbol.for('wallpaperdb.color-extractor.image-reader');
export const HISTOGRAM_PROVIDER = Symbol.for('wallpaperdb.color-extractor.histogram-provider');
export const COLORS_EXTRACTED_PUBLISHER = Symbol.for(
  'wallpaperdb.color-extractor.colors-extracted-publisher'
);
export const COLOR_EXTRACTION_USE_CASE = Symbol.for(
  'wallpaperdb.color-extractor.color-extraction-use-case'
);
