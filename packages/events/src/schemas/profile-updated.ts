import { z } from "zod";
import { PublicProfileSnapshotSchema } from "./profile-created.js";

export const PROFILE_UPDATED_SUBJECT = "profile.updated" as const;

export const ProfileUpdatedEventSchema = z
  .object({
    eventId: z.string().min(1),
    eventType: z.literal(PROFILE_UPDATED_SUBJECT),
    timestamp: z.string().datetime(),
    change: z
      .object({
        type: z.literal("display-name-changed"),
        before: z.string().min(1),
        after: z.string().min(1),
      })
      .strict(),
    profile: PublicProfileSnapshotSchema,
  })
  .strict();

export type ProfileUpdatedEvent = z.infer<typeof ProfileUpdatedEventSchema>;
