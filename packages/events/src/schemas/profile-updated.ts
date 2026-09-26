import { z } from "zod";
import { PublicProfileSnapshotSchema } from "./profile-created.js";
import { AssetReferenceSchema } from "./asset-reference.js";

const ProfileDetailsSchema = z
  .object({ displayName: z.string().min(1), biographyMarkdown: z.string() })
  .strict();

export const PROFILE_UPDATED_SUBJECT = "profile.updated" as const;

const pictureMetadata = z.object({
  id: z.string().min(1),
  mimeType: z.literal("image/webp"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fileSizeBytes: z.number().int().positive(),
});
const pictureAsset = z.union([
  pictureMetadata
    .extend({
      reference: AssetReferenceSchema.extend({ owner: z.literal("user") }),
    })
    .strict()
    .refine(
      (asset) => asset.reference.id === asset.id,
      "Picture reference must match asset identity"
    ),
  pictureMetadata
    .extend({
      reference: z.undefined().optional(),
      storageBucket: z.string().min(1),
      storageKey: z.string().min(1),
    })
    .strict(),
]);

export const ProfileUpdatedEventSchema = z
  .object({
    eventId: z.string().min(1),
    eventType: z.literal(PROFILE_UPDATED_SUBJECT),
    timestamp: z.string().datetime(),
    change: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("profile-details-changed"),
          before: ProfileDetailsSchema,
          after: ProfileDetailsSchema,
        })
        .strict(),
      z
        .object({ type: z.literal("biography-changed"), before: z.string(), after: z.string() })
        .strict(),
      z
        .object({
          type: z.literal("picture-changed"),
          before: z.string().min(1).nullable(),
          after: z.string().min(1).nullable(),
          source: z.enum(["upload", "clerk-import", "remove"]),
          asset: pictureAsset.nullable(),
        })
        .strict(),
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
          type: z.literal("alias-reactivated"),
          handle: z.string().min(1),
          claimGeneration: z.number().int().positive(),
          before: z.string().datetime().nullable(),
          after: z.null(),
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
