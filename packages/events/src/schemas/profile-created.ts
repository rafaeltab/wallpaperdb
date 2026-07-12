import { z } from "zod";

export const PROFILE_CREATED_SUBJECT = "profile.created" as const;

export const PublicProfileSnapshotSchema = z.object({
  id: z.string().min(1),
  handle: z.string().min(1),
  displayName: z.string().min(1),
  biographyMarkdown: z.string(),
  pictureAssetId: z.string().min(1).nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const ProfileCreatedEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal(PROFILE_CREATED_SUBJECT),
  timestamp: z.string().datetime(),
  profileVersion: z.number().int().positive(),
  change: z.object({ type: z.literal("created") }).strict(),
  profile: PublicProfileSnapshotSchema,
}).strict();

export type PublicProfileSnapshot = z.infer<typeof PublicProfileSnapshotSchema>;
export type ProfileCreatedEvent = z.infer<typeof ProfileCreatedEventSchema>;
