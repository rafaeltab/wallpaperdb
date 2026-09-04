import {
  BaseEventConsumer,
  PROFILE_UPDATED_SUBJECT,
  type ProfileUpdatedEvent,
  ProfileUpdatedEventSchema,
} from '@wallpaperdb/events';
import { inject, singleton } from 'tsyringe';
import { NatsConnectionManager } from '../connections/nats.js';
import { ProfileRepository } from '../repositories/profile.repository.js';

@singleton()
export class ProfileUpdatedConsumer extends BaseEventConsumer<typeof ProfileUpdatedEventSchema> {
  protected readonly schema = ProfileUpdatedEventSchema;
  protected readonly subject = PROFILE_UPDATED_SUBJECT;
  protected readonly eventType = PROFILE_UPDATED_SUBJECT;

  constructor(
    @inject(NatsConnectionManager) natsConnectionManager: NatsConnectionManager,
    @inject(ProfileRepository) private readonly profileRepository: ProfileRepository
  ) {
    super({
      natsConnectionProvider: () => natsConnectionManager.getClient(),
      serviceName: 'gateway',
      streamName: 'PROFILE',
      durableName: 'gateway-profile-updated',
      maxRetries: 3,
      ackWait: 30000,
    });
  }

  public async handleEvent(event: ProfileUpdatedEvent): Promise<void> {
    await this.profileRepository.project(event.profile);
  }
}
