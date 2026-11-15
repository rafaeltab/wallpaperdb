import { z } from 'zod';
import type { AgentResponse } from '../../capabilities/job/index.js';
export const receiptSchema = z.discriminatedUnion('kind', [
  z
    .object({
      version: z.literal(1),
      kind: z.literal('state'),
      jobId: z.string(),
      checks: z
        .object({
          format: z.boolean(),
          lint: z.boolean(),
          tests: z.boolean(),
          crap: z.boolean(),
          coverage: z.boolean(),
        })
        .strict(),
      base: z.string(),
      implemented: z.string(),
      checked: z.string(),
      reviewed: z.string().optional(),
      published: z.string().optional(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      kind: z.literal('dependencies'),
      jobId: z.string(),
      requireUnimplementedIssues: z.array(z.string()),
    })
    .strict(),
]) satisfies z.ZodType<AgentResponse>;
export const responseShape = `type AgentResponse =
  | { version: 1; kind: 'state'; jobId: string;
      checks: { format: boolean; lint: boolean; tests: boolean; crap: boolean; coverage: boolean };
      base: string; implemented: string; checked: string; reviewed?: string; published?: string }
  | { version: 1; kind: 'dependencies'; jobId: string; requireUnimplementedIssues: string[] };`;
