import { BaseEventPublisher } from '@wallpaperdb/events/publisher';
import {
  WALLPAPER_COLORS_EXTRACTED_SUBJECT,
  type WallpaperColorsExtractedEvent,
  WallpaperColorsExtractedEventSchema,
} from '@wallpaperdb/events/schemas';

export class WallpaperColorsExtractedPublisher extends BaseEventPublisher<
  typeof WallpaperColorsExtractedEventSchema
> {
  protected readonly schema = WallpaperColorsExtractedEventSchema;
  protected readonly subject = WALLPAPER_COLORS_EXTRACTED_SUBJECT;
  protected readonly eventType = 'wallpaper.colors.extracted';
}

export type { WallpaperColorsExtractedEvent };
