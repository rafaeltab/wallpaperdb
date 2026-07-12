import { z } from "zod";

export const PROFILE_CREATED_SUBJECT = "profile.created" as const;

export const ProfileCreatedEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal(PROFILE_CREATED_SUBJECT),
  timestamp: z.string().datetime(),
  profile: z.object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    handle: z.string().min(1),
    biographyMarkdown: z.string(),
    pictureAssetId: z.string().min(1).nullable(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
});

export type ProfileCreatedEvent = z.infer<typeof ProfileCreatedEventSchema>;
