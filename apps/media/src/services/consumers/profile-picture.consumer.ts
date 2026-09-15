import {
  BaseEventConsumer,
  ProfileCreatedEventSchema,
  ProfileUpdatedEventSchema,
  type ProfileCreatedEvent,
  type ProfileUpdatedEvent,
} from '@wallpaperdb/events';
import { inject, singleton } from 'tsyringe';
import { z } from 'zod';
import { NatsConnectionManager } from '../../connections/nats.js';
import { ProfilePictureRepository } from '../../repositories/profile-picture.repository.js';

const ProfileSnapshotEventSchema = z.union([ProfileCreatedEventSchema, ProfileUpdatedEventSchema]);

@singleton()
export class ProfilePictureConsumer extends BaseEventConsumer<typeof ProfileSnapshotEventSchema> {
  protected readonly schema = ProfileSnapshotEventSchema;
  protected readonly subject = 'profile.*';
  protected readonly eventType = 'profile';

  constructor(
    @inject(NatsConnectionManager) connection: NatsConnectionManager,
    @inject(ProfilePictureRepository) private readonly repository: ProfilePictureRepository
  ) {
    super({
      natsConnectionProvider: () => connection.getClient(),
      serviceName: 'media',
      streamName: 'PROFILE',
      durableName: 'media-profile-picture-snapshots',
      maxRetries: 3,
      ackWait: 30000,
    });
  }

  async handleEvent(event: ProfileCreatedEvent | ProfileUpdatedEvent): Promise<void> {
    await this.repository.project(event);
  }
}
