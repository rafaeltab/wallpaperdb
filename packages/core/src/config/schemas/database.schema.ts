import { z } from "zod";

export const DatabaseConfigSchema = z.object({
  databaseUrl: z.string().url(),
});

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
