import {
  BaseEventConsumer,
  WALLPAPER_UPLOADED_SUBJECT,
  type WallpaperUploadedEvent,
  WallpaperUploadedEventSchema,
} from '@wallpaperdb/events';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../../config.js';
import { DatabaseConnection } from '../../connections/database.js';
import { NatsConnectionManager } from '../../connections/nats.js';
import { wallpaperOwnership } from '../../db/schema.js';

@singleton()
export class WallpaperOwnershipConsumer extends BaseEventConsumer<typeof WallpaperUploadedEventSchema> {
  protected readonly schema = WallpaperUploadedEventSchema;
  protected readonly subject = WALLPAPER_UPLOADED_SUBJECT;
  protected readonly eventType = WALLPAPER_UPLOADED_SUBJECT;

  constructor(
    @inject(NatsConnectionManager) connection: NatsConnectionManager,
    @inject(DatabaseConnection) private readonly database: DatabaseConnection,
    @inject('config') config: Config
  ) {
    super({ natsConnectionProvider: () => connection.getClient(), serviceName: 'user',
      streamName: config.natsStream, durableName: 'user-wallpaper-ownership', maxRetries: 3, ackWait: 30_000 });
  }

  async handleEvent(event: WallpaperUploadedEvent): Promise<void> {
    await this.database.getClient().db.insert(wallpaperOwnership).values({
      wallpaperId: event.wallpaper.id, profileId: event.wallpaper.userId,
    }).onConflictDoNothing({ target: wallpaperOwnership.wallpaperId });
  }
}
