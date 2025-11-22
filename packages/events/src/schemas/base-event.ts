import { z } from "zod";

/**
 * Base schema for all events in the system.
 * All event schemas should extend this with their specific payload.
 */
export const BaseEventSchema = z.object({
  /** Unique event identifier (ULID) */
  eventId: z.string().min(1),
  /** Event type/subject (e.g., "wallpaper.uploaded") */
  eventType: z.string().min(1),
  /** ISO 8601 timestamp when the event was created */
  timestamp: z.string().datetime(),
});

export type BaseEvent = z.infer<typeof BaseEventSchema>;

/**
 * Helper to create an event schema that extends the base event.
 * Ensures consistent structure across all events.
 *
 * @example
 * ```typescript
 * const MyEventSchema = createEventSchema(
 *   z.literal("my.event"),
 *   z.object({ data: z.string() })
 * );
 * ```
 */
export function createEventSchema<
  TEventType extends z.ZodLiteral<string>,
  TPayload extends z.ZodObject<z.ZodRawShape>,
>(eventType: TEventType, payloadSchema: TPayload) {
  return z.object({
    eventId: z.string().min(1),
    eventType: eventType,
    timestamp: z.string().datetime(),
    payload: payloadSchema,
  });
}
