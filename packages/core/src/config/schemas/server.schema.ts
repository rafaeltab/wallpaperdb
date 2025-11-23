import { z } from "zod";

export const NodeEnvSchema = z.enum(["development", "production", "test"]);
export type NodeEnv = z.infer<typeof NodeEnvSchema>;

export const ServerConfigSchema = z.object({
  port: z.number().int().positive().default(3001),
  nodeEnv: NodeEnvSchema.default("development"),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
