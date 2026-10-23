import { readFileSync } from 'node:fs';
import { z } from 'zod';
const schema = z
  .object({
    credential: z.object({ user: z.string().min(1), password: z.string().min(1) }).strict(),
    operatorNotification: z.object({ url: z.string().url(), token: z.string().min(1) }).strict(),
    maxAttempts: z.number().int().min(1).max(100),
    retryDelayMs: z.number().int().min(1).max(30000),
    pollMs: z.number().int().min(1).max(30000),
    shutdownTimeoutMs: z.number().int().min(1).max(30000),
  })
  .strict();
export type AttachmentConfig = z.infer<typeof schema>;
export const parseAttachmentConfig = (input: unknown): AttachmentConfig => schema.parse(input);
export const readAttachmentConfig = (path: string): AttachmentConfig =>
  parseAttachmentConfig(JSON.parse(readFileSync(path, 'utf8')));
