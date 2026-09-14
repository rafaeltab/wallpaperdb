import { z } from "zod";

export const PROFILE_CREATED_SUBJECT = "profile.created" as const;

export const PublicProfileSnapshotSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    handle: z.string().min(1),
    claimGeneration: z.number().int().positive(),
    // Older retained events predate Handle changes and contain no aliases.
    aliases: z.array(z.object({
      handle: z.string().min(1),
      claimGeneration: z.number().int().positive(),
    }).strict()).optional(),
    biographyMarkdown: z.string(),
    pictureAssetId: z.string().min(1).nullable(),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type PublicProfileSnapshot = z.infer<typeof PublicProfileSnapshotSchema>;

export const ProfileCreatedEventSchema = z
  .object({
    eventId: z.string().min(1),
    eventType: z.literal(PROFILE_CREATED_SUBJECT),
    timestamp: z.string().datetime(),
    change: z.object({ type: z.literal("created") }).strict(),
    profile: PublicProfileSnapshotSchema,
  })
  .strict();

export type ProfileCreatedEvent = z.infer<typeof ProfileCreatedEventSchema>;
