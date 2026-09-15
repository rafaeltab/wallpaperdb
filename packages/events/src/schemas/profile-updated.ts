import { z } from "zod";
import { PublicProfileSnapshotSchema } from "./profile-created.js";

export const PROFILE_UPDATED_SUBJECT = "profile.updated" as const;

export const ProfileUpdatedEventSchema = z
  .object({
    eventId: z.string().min(1),
    eventType: z.literal(PROFILE_UPDATED_SUBJECT),
    timestamp: z.string().datetime(),
    change: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("display-name-changed"),
          before: z.string().min(1),
          after: z.string().min(1),
        })
        .strict(),
      z
        .object({
          type: z.literal("handle-changed"),
          before: z.string().min(1),
          after: z.string().min(1),
          scheduledAliases: z
            .array(
              z
                .object({
                  handle: z.string().min(1),
                  expiresAt: z.string().datetime(),
                })
                .strict()
            )
            .optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal("alias-expiry-scheduled"),
          handle: z.string().min(1),
          before: z.null(),
          after: z.string().datetime(),
        })
        .strict(),
      z
        .object({
          type: z.literal("alias-expired"),
          handle: z.string().min(1),
          claimGeneration: z.number().int().positive(),
          before: z.string().datetime(),
          after: z.null(),
          reason: z.enum(["scheduled", "immediate"]),
        })
        .strict(),
    ]),
    profile: PublicProfileSnapshotSchema,
  })
  .strict();

export type ProfileUpdatedEvent = z.infer<typeof ProfileUpdatedEventSchema>;
