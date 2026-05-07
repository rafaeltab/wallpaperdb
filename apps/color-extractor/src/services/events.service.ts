import { NatsConnectionManager } from '../connections/nats.js';
import { inject, injectable } from 'tsyringe';
import type { Config } from '../config.js';
import { WallpaperColorsExtractedPublisher } from './publishers/wallpaper-colors-extracted.publisher.js';

@injectable()
export class EventsService {
  private publisher: WallpaperColorsExtractedPublisher | null = null;

  constructor(
    @inject(NatsConnectionManager) private readonly natsClient: NatsConnectionManager,
    @inject('config') private readonly config: Config
  ) {}

  private getPublisher(): WallpaperColorsExtractedPublisher {
    if (!this.publisher) {
      this.publisher = new WallpaperColorsExtractedPublisher({
        natsConnection: this.natsClient.getClient(),
        serviceName: this.config.otelServiceName,
      });
    }
    return this.publisher;
  }

  async publishColorsExtracted(
    wallpaperId: string,
    colorHistogram: number[],
    colorSpace: string
  ): Promise<void> {
    await this.getPublisher().publishNew({
      wallpaperId,
      colorHistogram,
      colorSpace,
    });
  }
}
