import { readFileSync } from 'node:fs';
import { z } from 'zod';
const https = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:');
const identity = z.string().min(1).max(256);
const schema = z
  .object({
    ownerNamespace: identity,
    credential: z.object({ user: identity, password: z.string().min(1) }).strict(),
    identityProviders: z
      .array(
        z
          .object({
            issuer: https,
            jwksUrl: https,
            ownerNamespace: identity,
            audience: z.array(identity),
            authorizedParties: z.array(z.string().url()),
            requireAuthorizedParty: z.boolean(),
          })
          .strict()
          .refine((p) => new URL(p.issuer).origin === new URL(p.jwksUrl).origin)
      )
      .min(1),
    maxAttempts: z.number().int().min(1).max(100),
    retryDelayMs: z.number().int().min(1).max(30000),
    pollMs: z.number().int().min(1).max(30000),
    shutdownTimeoutMs: z.number().int().min(1).max(30000),
  })
  .strict()
  .refine(
    (value) =>
      value.identityProviders.every((p) => p.ownerNamespace === value.ownerNamespace) &&
      new Set(value.identityProviders.map((p) => p.issuer)).size === value.identityProviders.length
  );
export type WorkflowConfig = z.infer<typeof schema>;
export const parseWorkflowConfig = (input: unknown): WorkflowConfig => schema.parse(input);
export const readWorkflowConfig = (path: string): WorkflowConfig =>
  parseWorkflowConfig(JSON.parse(readFileSync(path, 'utf8')));
