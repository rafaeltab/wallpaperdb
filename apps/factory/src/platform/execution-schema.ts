import { z } from 'zod';
export const executionSettingsSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    effort: z.string().min(1).max(100).nullable(),
    mode: z.enum(['standard', 'fast']).nullable(),
    permissionLevel: z
      .enum(['approval-required', 'auto-accept-edits', 'auto', 'full-access'])
      .nullable(),
  })
  .strict();
