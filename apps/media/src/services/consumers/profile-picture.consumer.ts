import { BaseEventConsumer, PROFILE_UPDATED_SUBJECT, ProfileUpdatedEventSchema, type ProfileUpdatedEvent } from '@wallpaperdb/events';
import { inject, singleton } from 'tsyringe';
import { NatsConnectionManager } from '../../connections/nats.js';
import { ProfilePictureRepository } from '../../repositories/profile-picture.repository.js';

@singleton()
export class ProfilePictureConsumer extends BaseEventConsumer<typeof ProfileUpdatedEventSchema> {
  protected readonly schema = ProfileUpdatedEventSchema;
  protected readonly subject = PROFILE_UPDATED_SUBJECT;
  protected readonly eventType = PROFILE_UPDATED_SUBJECT;

  constructor(
    @inject(NatsConnectionManager) connection: NatsConnectionManager,
    @inject(ProfilePictureRepository) private readonly repository: ProfilePictureRepository
  ) {
    super({
      natsConnectionProvider: () => connection.getClient(),
      serviceName: 'media', streamName: 'PROFILE', durableName: 'media-profile-pictures',
      maxRetries: 3, ackWait: 30000,
    });
  }

  async handleEvent(event: ProfileUpdatedEvent): Promise<void> {
    await this.repository.project(event);
  }
}
