import { z } from "zod";

export const OtelConfigSchema = z.object({
	otelEndpoint: z.string().url(),
	otelServiceName: z.string().min(1),
});

export type OtelConfig = z.infer<typeof OtelConfigSchema>;
