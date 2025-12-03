import { z } from "zod";

export const OpenSearchConfigSchema = z.object({
  opensearchUrl: z.string().url(),
  opensearchUsername: z.string().optional(),
  opensearchPassword: z.string().optional(),
});

export type OpenSearchConfig = z.infer<typeof OpenSearchConfigSchema>;
