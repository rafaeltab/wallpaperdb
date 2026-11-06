import { sql } from 'drizzle-orm';
import {
  primaryKey,
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';
export const records = sqliteTable(
  'records',
  {
    namespace: text('namespace').notNull(),
    name: text('name').notNull(),
    value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.namespace, table.name] })]
);
export const metadata = sqliteTable('metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const planningAttempts = sqliteTable(
  'planning_attempts',
  {
    id: text('id').primaryKey(),
    revision: integer('revision').notNull(),
    startedAt: integer('started_at').notNull(),
    deadline: integer('deadline').notNull(),
    phase: text('phase', {
      enum: ['discovery', 'handoff', 'freshness', 'succeeded', 'failed'],
    }).notNull(),
    slot: integer('slot').notNull().default(1),
    finishedAt: integer('finished_at'),
    detail: text('detail'),
    result: text('result', { mode: 'json' }).$type<unknown>(),
  },
  (table) => [
    check('planning_attempt_slot', sql`${table.slot} = 1`),
    check(
      'planning_attempt_phase',
      sql`${table.phase} in ('discovery', 'handoff', 'freshness', 'succeeded', 'failed')`
    ),
    check('planning_attempt_revision', sql`${table.revision} >= 0`),
    uniqueIndex('one_active_planning_attempt')
      .on(table.slot)
      .where(sql`${table.phase} in ('discovery', 'handoff', 'freshness')`),
  ]
);

// Replaceable external observations are separate from immutable workflow records.
export const githubIssues = sqliteTable('github_issues', {
  number: integer('number').primaryKey(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  open: integer('open', { mode: 'boolean' }).notNull(),
  candidate: integer('candidate', { mode: 'boolean' }).notNull(),
  labels: text('labels', { mode: 'json' }).$type<readonly string[]>().notNull(),
  assignees: text('assignees', { mode: 'json' }).$type<readonly string[]>().notNull(),
  projectStatus: text('project_status'),
  projectPriority: text('project_priority'),
  projectSize: text('project_size'),
  commentCount: integer('comment_count').notNull(),
  blockers: text('blockers', { mode: 'json' }).$type<readonly number[]>().notNull(),
  parents: text('parents', { mode: 'json' }).$type<readonly number[]>().notNull(),
  pullRequests: text('pull_requests', { mode: 'json' }).$type<readonly number[]>().notNull(),
});
export const githubPulls = sqliteTable('github_pulls', {
  number: integer('number').primaryKey(),
  url: text('url').notNull(),
  state: text('state', { enum: ['OPEN', 'CLOSED', 'MERGED'] }).notNull(),
  head: text('head').notNull(),
  headBranch: text('head_branch').notNull(),
  base: text('base').notNull(),
  baseBranch: text('base_branch').notNull(),
  crossReferencedIssues: text('cross_referenced_issues', { mode: 'json' })
    .$type<readonly number[]>()
    .notNull(),
  linkedIssues: text('linked_issues', { mode: 'json' }).$type<readonly number[]>().notNull(),
  review: text('review', {
    enum: ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', 'UNKNOWN'],
  }).notNull(),
  ci: text('ci', { enum: ['SUCCESS', 'FAILURE', 'PENDING', 'UNKNOWN'] }).notNull(),
  evidenceHead: text('evidence_head').notNull(),
});
export const observationRefresh = sqliteTable('observation_refresh', {
  id: integer('id').primaryKey(),
  startedAt: integer('started_at'),
  observedAt: integer('observed_at'),
  failedAt: integer('failed_at'),
  error: text('error'),
  recoveries: text('recoveries', { mode: 'json' }).$type<
    readonly import('../capabilities/job/index.js').RecoveryStatus[]
  >(),
  jobs: text('jobs', { mode: 'json' }).$type<
    readonly import('../capabilities/job/index.js').Status[]
  >(),
  jobsObservedAt: integer('jobs_observed_at'),
});

export const t3Observations = sqliteTable('t3_observations', {
  id: integer('id').primaryKey(),
  value: text('value', { mode: 'json' })
    .$type<import('../capabilities/observe/index.js').ThreadState>()
    .notNull(),
});

export const v2Board = sqliteTable('v2_board', {
  scope: text('scope').primaryKey(),
  value: text('value', { mode: 'json' })
    .$type<import('../capabilities/board/index.js').BoardRecord>()
    .notNull(),
});
export const v2Commands = sqliteTable('v2_commands', {
  basis: text('basis', { mode: 'json' }).$type<
    import('../capabilities/board/index.js').PlanAttempt['basis']
  >(),
  id: text('id').primaryKey(),
  scope: text('scope').notNull(),
  request: text('request', { mode: 'json' })
    .$type<import('../capabilities/board/index.js').BoardCommand>()
    .notNull(),
  receipt: text('receipt', { mode: 'json' })
    .$type<import('../capabilities/board/index.js').CommandReceipt>()
    .notNull(),
});
export const githubRichFacts = sqliteTable('github_rich_facts', {
  id: integer('id').primaryKey(),
  value: text('value', { mode: 'json' })
    .$type<{ observedAt: number; facts: import('../capabilities/observe/index.js').Facts }>()
    .notNull(),
});
