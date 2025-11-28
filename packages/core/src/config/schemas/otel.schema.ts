import { z } from "zod";

export const OtelConfigSchema = z.object({
  otelEndpoint: z.string().url().optional(),
  otelServiceName: z.string().min(1).default("wallpaperdb"),
});

export type OtelConfig = z.infer<typeof OtelConfigSchema>;
