import {
  BaseEventConsumer,
  PROFILE_CREATED_SUBJECT,
  ProfileCreatedEventSchema,
  PublicProfileSnapshotSchema,
} from '@wallpaperdb/events';
import { inject, singleton } from 'tsyringe';
import { z } from 'zod';
import { NatsConnectionManager } from '../connections/nats.js';
import { ProfileRepository } from '../repositories/profile.repository.js';

const LegacyProfileCreatedEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal(PROFILE_CREATED_SUBJECT),
  timestamp: z.string().datetime(),
  profile: PublicProfileSnapshotSchema.strip(),
});

const ProfileProjectionEventSchema = z.union([
  ProfileCreatedEventSchema,
  LegacyProfileCreatedEventSchema,
]);

@singleton()
export class ProfileCreatedConsumer extends BaseEventConsumer<typeof ProfileProjectionEventSchema> {
  protected readonly schema = ProfileProjectionEventSchema;
  protected readonly subject = PROFILE_CREATED_SUBJECT;
  protected readonly eventType = PROFILE_CREATED_SUBJECT;

  constructor(
    @inject(NatsConnectionManager) natsConnectionManager: NatsConnectionManager,
    @inject(ProfileRepository) private readonly profileRepository: ProfileRepository
  ) {
    super({
      natsConnectionProvider: () => natsConnectionManager.getClient(),
      serviceName: 'gateway',
      streamName: 'PROFILE',
      durableName: 'gateway-profile-created',
      maxRetries: 3,
      ackWait: 30000,
    });
  }

  public async handleEvent(event: z.infer<typeof ProfileProjectionEventSchema>): Promise<void> {
    await this.profileRepository.project(event.profile);
  }
}
