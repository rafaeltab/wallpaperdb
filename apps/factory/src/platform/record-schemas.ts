import { z } from 'zod';
export const intentSchema = z
  .object({
    id: z.string().min(1),
    issue: z.number().int().positive(),
    issueUrl: z.string().url(),
    issueTitle: z.string().optional(),
    prerequisiteEvidence: z.string().optional(),
    prBase: z.string().optional(),
    base: z.string().regex(/^[a-f0-9]{40}$/),
    context: z.string(),
    branch: z.string(),
    createdAt: z.number().finite(),
    expectedStage: z.literal('implementation'),
  })
  .strict();
const stageSchema = z
  .object({
    ordinal: z.number().int().positive().optional(),
    comparison: z
      .object({
        base: z.string().regex(/^[a-f0-9]{40}$/),
        prBase: z.string().min(1),
        previousHead: z.string().regex(/^[a-f0-9]{40}$/),
        owningHeads: z.array(z.string().regex(/^[a-f0-9]{40}$/)).optional(),
      })
      .strict()
      .optional(),
    continuation: z.boolean().optional(),
    resume: z.boolean().optional(),
    observedRunId: z.string().optional(),
    question: z.object({ id: z.string(), text: z.string() }).optional(),
    deliveryIndex: z.number().int().nonnegative().optional(),
    index: z.number().int().min(0),
    stage: z.enum(['implementation', 'review', 'publication', 'babysitting', 'ci']),
    threadId: z.string().min(1),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    previousRunId: z.string().min(1).nullable(),
  })
  .strict();
const waitSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    progress: z.string(),
    deadline: z.number().finite(),
    nudged: z.boolean(),
    continuation: stageSchema.optional(),
  })
  .strict();
const controlSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    cancelled: z.boolean(),
    claimed: z.array(z.number().int().nonnegative()),
    prerequisite: z
      .object({
        url: z.string().url(),
        commit: z.string().regex(/^[a-f0-9]{40}$/),
        reviewedCommit: z
          .string()
          .regex(/^[a-f0-9]{40}$/)
          .optional(),
        parent: z
          .string()
          .regex(/^[a-f0-9]{40}$/)
          .optional(),
        base: z.string().optional(),
      })
      .optional(),
    parked: z
      .object({
        index: z.number().int().nonnegative(),
        run: z.object({ id: z.string(), ordinal: z.number().int().positive() }).optional(),
        question: z.object({ id: z.string(), text: z.string() }),
      })
      .optional(),
  })
  .strict();
const scheduleSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    concurrency: z
      .number()
      .int()
      .refine((v) => v === -1 || v > 0),
    allowance: z
      .number()
      .int()
      .refine((v) => v === -1 || v > 0),
    paused: z.boolean(),
    resuming: z
      .array(
        z
          .object({
            issue: z.number().int().positive(),
            index: z.number().int().nonnegative(),
            questionId: z.string().min(1).optional(),
            runId: z.string().min(1).optional(),
            run: z
              .object({ id: z.string().min(1), ordinal: z.number().int().positive() })
              .optional(),
          })
          .strict()
      )
      .optional(),
    admissions: z.array(
      z
        .object({
          issue: z.number().int().positive(),
          prerequisiteEvidence: z.string().optional(),
          prBase: z.string().optional(),
          base: z.string().regex(/^[a-f0-9]{40}$/),
          context: z.string().max(16000),
        })
        .strict()
    ),
  })
  .strict();

export { stageSchema, waitSchema, controlSchema, scheduleSchema };
export const plannerSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    requestId: z.string().min(1),
    input: z.string(),
    deadline: z.number().finite(),
    run: z.object({ threadId: z.string().min(1), runId: z.string().min(1) }).optional(),
    retired: z.boolean().optional(),
  })
  .strict();
const sha = z.string().regex(/^[a-f0-9]{40}$/);
export const joinBoundarySchema = z.object({
  base: sha,
  prBase: z.string(),
  pin: sha,
  landed: z
    .array(
      z.object({
        issue: z.number().int().positive(),
        pr: z.number().int().positive(),
        commit: sha,
        url: z.string(),
        branch: z.string(),
        tip: sha,
        originalHead: sha.optional(),
      })
    )
    .max(100),
});
export const journalLayer = z.object({
  issue: z.number().int().positive(),
  pr: z.number().int().positive(),
  commit: sha,
  reviewedCommit: sha.optional(),
  context: z.string().optional(),
  owningThreadId: z.string().optional(),
  branch: z.string(),
  url: z.string(),
  parent: sha,
  prBase: z.string(),
});
export const journalGroup = z.object({
  number: z.number().int().positive(),
  pull_requests: z.array(z.object({ number: z.number().int().positive() })),
});
export const journalLanding = z.object({
  anchor: journalLayer,
  commit: sha,
  branch: z.string(),
  covered: z.array(sha).default([]),
  removed: z.array(z.number()).default([]),
});
export const journalIntent = z.object({
  writerKey: z.string().optional(),
  boundary: joinBoundarySchema.optional(),
  landing: journalLanding.optional(),
  groups: z.array(journalGroup),
  members: z.array(z.number().int().positive()),
  numbers: z.array(z.number().int()).max(100),
  generation: sha.optional(),
  repairOf: sha.optional(),
  layers: z.array(journalLayer),
  replay: z.array(journalLayer.extend({ next: sha, onto: sha, target: z.string(), tree: sha })),
});
