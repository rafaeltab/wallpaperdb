import { z } from 'zod';
import { executionSettingsSchema, observedExecutionSchema } from './execution-schema.js';
export const intentSchema = z
  .object({
    execution: executionSettingsSchema.optional(),
    receiptProtocol: z.literal('delivery-v1').optional(),
    generation: z.number().int().nonnegative().optional(),
    id: z.string().min(1),
    issue: z.number().int().positive(),
    issueUrl: z.string().url(),
    issueTitle: z.string().optional(),
    includeCodeFromIssues: z.array(z.number().int().positive()).optional(),
    selectionBase: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
    prerequisiteEvidence: z.string().optional(),
    prBase: z.string().optional(),
    base: z.string().regex(/^[a-f0-9]{40}$/),
    context: z.string(),
    branch: z.string(),
    createdAt: z.number().finite(),
    expectedStage: z.literal('implementation'),
  })
  .strict();
const reconciliationReasonSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('checks-incomplete'),
      checks: z
        .array(z.enum(['format', 'lint', 'tests', 'crap', 'coverage']))
        .min(1)
        .max(5),
    })
    .strict(),
  z
    .object({
      kind: z.enum([
        'response-missing',
        'invalid-response',
        'receipt-mismatch',
        'instruction-unavailable',
        'review-unverified',
        'publication-unverified',
        'checkout-dirty',
        'head-mismatch',
        'comparison-unverified',
        'publication-mismatch',
      ]),
    })
    .strict(),
]);
const stageSchema = z
  .object({
    acceptedBase: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .optional(),
    receiptProtocol: z.literal('delivery-v1').optional(),
    handback: z.array(z.string()).optional(),
    reconciliation: z.enum(['state', 'migration']).optional(),
    reconciliationReason: reconciliationReasonSchema.optional(),
    repairOrigin: z.number().int().nonnegative().optional(),
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
    retirement: z
      .object({
        publication: z
          .object({
            url: z.string().url(),
            commit: z.string().regex(/^[a-f0-9]{40}$/),
            base: z.string().optional(),
            lifecycle: z.string().optional(),
          })
          .strict(),
        execution: z
          .object({
            threadId: z.string().min(1),
            status: z.enum([
              'completed',
              'idle',
              'failed',
              'interrupted',
              'cancelled',
              'rolled_back',
            ]),
            run: z
              .object({ id: z.string().min(1), ordinal: z.number().int().positive() })
              .strict()
              .optional(),
          })
          .strict(),
        stageIndex: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    ownership: z
      .object({ threadId: z.string().min(1), prUrl: z.string().url().optional() })
      .strict()
      .optional(),
    released: z.boolean().optional(),
    dependencyRecovery: z
      .object({
        index: z.number().int().nonnegative(),
        run: z.object({ id: z.string().min(1), ordinal: z.number().int().positive() }),
        progress: z.string().max(1000),
      })
      .strict()
      .optional(),
    reconciliation: z
      .object({
        attempts: z.number().int().nonnegative(),
        migrated: z.boolean(),
        pending: stageSchema.optional(),
      })
      .strict()
      .optional(),
    manualRepair: z
      .object({
        index: z.number().int().nonnegative(),
        threadId: z.string().min(1),
        run: z.object({ id: z.string().min(1), ordinal: z.number().int().positive() }).strict(),
        adoption: stageSchema.optional(),
      })
      .strict()
      .optional(),
    restart: z.object({ index: z.number().int().positive() }).strict().optional(),
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
    execution: executionSettingsSchema.optional(),
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
    controlsRevision: z.number().int().min(-1).optional(),
    recovering: z.array(z.number().int().positive()).optional(),
    cycle: z
      .object({
        requestId: z.string().min(1),
        startedAt: z.number().finite(),
        concurrency: z.number().int(),
        allowance: z.number().int(),
        selected: z
          .array(
            z
              .object({
                issue: z.number().int().positive(),
                reason: z.string(),
                includeCodeFromIssues: z.array(z.number().int().positive()).max(100),
              })
              .strict()
          )
          .max(1000)
          .optional(),
        scope: z.string().optional(),
        modelAttemptId: z.string().optional(),
        bases: z
          .array(
            z
              .object({
                issue: z.number().int().positive(),
                base: z.string().regex(/^[a-f0-9]{40}$/),
              })
              .strict()
          )
          .optional(),
      })
      .strict()
      .optional(),
    resuming: z
      .array(
        z
          .object({
            issue: z.number().int().positive(),
            index: z.number().int().nonnegative(),
            questionId: z.string().min(1).optional(),
            runId: z.string().min(1).optional(),
            retryThreadId: z.string().min(1).optional(),
            run: z
              .object({ id: z.string().min(1), ordinal: z.number().int().positive() })
              .optional(),
          })
          .strict()
      )
      .optional(),
    released: z
      .array(
        z
          .object({
            jobId: z.string().min(1),
            admission: z
              .object({
                execution: executionSettingsSchema.optional(),
                issue: z.number().int().positive(),
                generation: z.number().int().nonnegative().optional(),
                base: z.string().regex(/^[a-f0-9]{40}$/),
                context: z.string(),
                includeCodeFromIssues: z.array(z.number().int().positive()).optional(),
                selectionBase: z.string().optional(),
                prerequisiteEvidence: z.string().optional(),
                prBase: z.string().optional(),
              })
              .strict(),
          })
          .strict()
      )
      .optional(),
    admissions: z.array(
      z
        .object({
          execution: executionSettingsSchema.optional(),
          issue: z.number().int().positive(),
          includeCodeFromIssues: z.array(z.number().int().positive()).optional(),
          selectionBase: z
            .string()
            .regex(/^[a-f0-9]{40}$/)
            .optional(),
          generation: z.number().int().nonnegative().optional(),
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
    observedExecution: observedExecutionSchema.optional(),
    execution: executionSettingsSchema.optional(),
    revision: z.number().int().nonnegative(),
    requestId: z.string().min(1),
    input: z.string(),
    inputIdentity: z.string().optional(),
    automatic: z.boolean().optional(),
    attemptStartedAt: z.number().finite().optional(),
    modelHandedOffAt: z.number().finite().optional(),
    deadline: z.number().finite().optional(),
    completedAt: z.number().finite().optional(),
    settled: z.boolean().optional(),
    run: z.object({ threadId: z.string().min(1), runId: z.string().min(1) }).optional(),
    retired: z.boolean().optional(),
    phase: z.enum(['launch-intent', 'running', 'succeeded', 'failed', 'uncertain']).optional(),
    detail: z.string().max(1000).optional(),
    reconciliation: z
      .object({
        operator: z.string().min(1),
        evidence: z.string().min(1).max(1000),
        code: z.literal(-32602),
        at: z.number(),
      })
      .strict()
      .optional(),
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
