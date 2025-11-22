import { z } from "zod";

export const NatsConfigSchema = z.object({
	natsUrl: z.string().url(),
	natsStream: z.string().default("WALLPAPER"),
});

export type NatsConfig = z.infer<typeof NatsConfigSchema>;
