import { z } from "zod";

export const RedisConfigSchema = z.object({
	redisHost: z.string().default("localhost"),
	redisPort: z.number().int().positive().default(6379),
	redisPassword: z.string().optional(),
	redisEnabled: z.boolean().default(true),
});

export type RedisConfig = z.infer<typeof RedisConfigSchema>;
