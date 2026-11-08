/** V2 wire contract. A separate fake server implements the transports;
 * the live factory producer is not implemented.
 * Semantics, collection scope, transport and migration: docs/factory-interface-v2.md.
 * JSON only. IDs and versions are opaque; timestamps are RFC 3339 UTC strings.
 */
export type Timestamp = string;
export type Version = string;
export type Cursor = string;
export type EntityId<Kind extends string> = `${Kind}:${string}`;
export type IssueId = EntityId<'issue'>;
export type PullRequestId = EntityId<'pr'>;
export type JobId = EntityId<'job'>;
export type ThreadId = EntityId<'thread'>;
export type WorkItemId = EntityId<'item'>;
export type ActionId = EntityId<'action'>;
export type RepositoryId = EntityId<'repository'>;
export type UserId = EntityId<'user'>;
export type LabelId = EntityId<'label'>;
export type SourceId = EntityId<'source'>;

export interface Entity<Id extends string> {
  readonly id: Id;
  readonly version: Version;
}

/** A known null means observed absence. Unknown never means empty, false or ready.
 * Retained known values remain dated by their source when a refresh fails.
 */
export type Fact<Value> =
  | {
      readonly state: 'known';
      readonly value: Value;
      readonly sourceId: SourceId;
      readonly observedAt: Timestamp;
    }
  | { readonly state: 'unknown'; readonly sourceId: SourceId; readonly reason: string };

export interface Source extends Entity<SourceId> {
  readonly kind: 'factory' | 'github' | 't3';
  readonly observedAt: Timestamp | null;
  readonly staleAt: Timestamp | null;
  readonly refresh: 'idle' | 'refreshing' | 'failed' | 'unavailable';
  readonly lastAttemptAt: Timestamp | null;
  readonly nextAttemptAt: Timestamp | null;
  readonly failure: { readonly code: string; readonly message: string } | null;
}

export interface Repository extends Entity<RepositoryId> {
  readonly owner: string;
  readonly name: string;
  readonly url: string;
  readonly defaultBranch: string;
}
export interface User extends Entity<UserId> {
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly url: string;
}
export interface Label extends Entity<LabelId> {
  readonly repositoryId: RepositoryId;
  readonly name: string;
  /** Six hexadecimal digits without '#'. */
  readonly color: string;
}
export interface Choice {
  readonly id: string;
  readonly name: string;
  /** Zero is highest priority / smallest size. Null means ordering is unknown. */
  readonly rank: number | null;
}
export interface Issue extends Entity<IssueId> {
  readonly repositoryId: RepositoryId;
  readonly number: number;
  readonly metadata: Fact<{
    readonly title: string;
    readonly url: string;
    readonly state: 'open' | 'closed';
    readonly updatedAt: Timestamp;
    readonly labelIds: readonly LabelId[];
    readonly assigneeIds: readonly UserId[];
    readonly commentCount: number;
  }>;
  readonly project: Fact<{
    readonly projectId: string | null;
    readonly status: Choice | null;
    readonly priority: Choice | null;
    readonly size: Choice | null;
  }>;
  /** Eligibility for a new admission, not merely the ready-for-agent label. */
  readonly eligibility: Decision;
}

export interface Comparison {
  readonly headOid: string;
  readonly baseOid: string;
  readonly baseRef: string;
}
/** Provider evidence can identify only its head. Never invent the tested base. */
export interface EvidenceComparison {
  readonly headOid: string;
  readonly baseOid: string | null;
  readonly baseRef: string | null;
}
export interface CheckGroup {
  readonly id: string;
  readonly name: string;
  readonly state: 'passed' | 'failed' | 'running' | 'queued' | 'skipped' | 'neutral' | 'unknown';
  readonly requirement: 'required' | 'optional' | 'unknown';
  readonly total: number;
  readonly completed: number;
  readonly url: string | null;
}
export interface CheckSummary {
  readonly comparison: EvidenceComparison;
  readonly state: 'passed' | 'failed' | 'pending' | 'unknown';
  readonly complete: boolean;
  /** Actual configured checks/categories; never four fabricated passing checks. */
  readonly groups: readonly CheckGroup[];
}
export interface ReviewSummary {
  readonly comparison: EvidenceComparison;
  readonly state: 'approved' | 'changes-requested' | 'required' | 'unknown';
  readonly complete: boolean;
  readonly reviewers: readonly {
    readonly userId: UserId;
    readonly state: 'requested' | 'approved' | 'changes-requested' | 'commented' | 'dismissed';
    readonly submittedAt: Timestamp | null;
    readonly reviewedHeadOid: string | null;
  }[];
}
export interface PullRequest extends Entity<PullRequestId> {
  readonly repositoryId: RepositoryId;
  readonly number: number;
  readonly metadata: Fact<{
    readonly title: string;
    readonly url: string;
    readonly state: 'open' | 'closed' | 'merged';
    readonly draft: boolean;
    readonly labelIds: readonly LabelId[];
    readonly headRef: string;
    readonly baseRef: string;
    readonly comparison: Comparison;
    readonly mergeability: 'clean' | 'conflicting' | 'pending' | 'unknown';
    readonly updatedAt: Timestamp;
  }>;
  readonly checks: Fact<CheckSummary>;
  readonly reviews: Fact<ReviewSummary>;
  /** Factory acceptance of this comparison, independent of GitHub's green checks. */
  readonly readiness: Readiness;
}

export interface Reason {
  readonly code: string;
  readonly message: string;
}
export interface Decision {
  readonly state: 'allowed' | 'blocked' | 'unknown';
  readonly reasons: readonly Reason[];
  readonly sourceIds: readonly SourceId[];
}
export type Readiness =
  | {
      readonly state: 'unknown' | 'not-ready';
      readonly reasons: readonly Reason[];
      readonly sourceIds: readonly SourceId[];
    }
  | {
      readonly state: 'ready' | 'landed';
      readonly comparison: Comparison;
      readonly verifiedAt: Timestamp;
      readonly sourceIds: readonly SourceId[];
    };

export type Relationship = Entity<EntityId<'relationship'>> &
  (
    | {
        readonly kind: 'parent';
        readonly parentIssueId: IssueId;
        readonly childIssueId: IssueId;
        readonly evidence: Fact<'github-native' | 'trusted-fallback'>;
      }
    | {
        readonly kind: 'prerequisite';
        readonly prerequisiteIssueId: IssueId;
        readonly dependantIssueId: IssueId;
        readonly evidence: Fact<'github-native' | 'trusted-fallback'>;
        readonly satisfaction:
          | { readonly state: 'unsatisfied' | 'unknown'; readonly reasons: readonly Reason[] }
          | {
              readonly state: 'satisfied';
              readonly basis: 'verified-unmerged' | 'verified-landed';
              readonly pullRequestId: PullRequestId;
              readonly comparison: Comparison;
              readonly verifiedAt: Timestamp;
            };
      }
    | {
        readonly kind: 'issue-pr';
        readonly issueId: IssueId;
        readonly pullRequestId: PullRequestId;
        readonly evidence: Fact<'factory-binding' | 'closing-reference' | 'cross-reference'>;
        readonly ownership: 'confirmed' | 'context-only' | 'ambiguous';
      }
    | {
        readonly kind: 'pr-base';
        readonly basePullRequestId: PullRequestId;
        readonly tipPullRequestId: PullRequestId;
        readonly evidence: Fact<'factory-journal' | 'git-ancestry'>;
      }
  );
export interface Stack extends Entity<EntityId<'stack'>> {
  /** Linear, base first. A PR occurs at most once across these display stacks. */
  readonly pullRequestIdsBaseToTip: readonly PullRequestId[];
  readonly base: { readonly ref: string; readonly oid: string };
  readonly evidence: Fact<'factory-journal' | 'git-ancestry'>;
}

export interface Thread extends Entity<ThreadId> {
  readonly metadata: Fact<{
    readonly title: string;
    readonly createdAt: Timestamp | null;
    readonly updatedAt: Timestamp | null;
    readonly status: string;
    readonly environmentId: string;
    readonly threadId: string;
    readonly webUrl: string | null;
    readonly nativeUrl: string | null;
  }>;
  readonly association:
    | {
        readonly state: 'confirmed';
        readonly issueIds: readonly IssueId[];
        readonly pullRequestIds: readonly PullRequestId[];
        readonly evidence: 'factory-binding' | 'closing-reference';
      }
    | { readonly state: 'absent' | 'ambiguous' | 'unknown'; readonly reasons: readonly Reason[] };
}
export interface Job extends Entity<JobId> {
  readonly issueId: IssueId;
  readonly pullRequestId: PullRequestId | null;
  readonly threadId: ThreadId | null;
  /** Null for a retained admission whose owning execution has not been observed. */
  readonly startedAt: Timestamp | null;
  readonly stage: 'implementation' | 'review' | 'publication' | 'babysitting' | 'ci' | 'unknown';
  readonly activity: string;
  readonly activityStartedAt: Timestamp | null;
  readonly deadline: Timestamp | null;
  readonly progress: string;
  readonly execution: Fact<{
    readonly runId: string | null;
    readonly state: 'running' | 'waiting' | 'finished' | 'interrupted' | 'unknown';
  }>;
  readonly occupiesCapacity: boolean;
  readonly cancelled: boolean;
  readonly question: { readonly id: string; readonly summary: string } | null;
}
export interface Maintenance extends Entity<EntityId<'maintenance'>> {
  readonly issueId: IssueId;
  readonly pullRequestId: PullRequestId;
  readonly threadId: ThreadId | null;
  readonly phase:
    | 'restacking'
    | 'resolving'
    | 'reviewing'
    | 'verifying'
    | 'publishing'
    | 'manual-recovery'
    | 'unknown';
  readonly resolution: 'simple' | 'complex' | 'unknown';
  readonly progress: string;
  readonly startedAt: Timestamp | null;
  readonly occupiesCapacity: boolean;
}

export type Attention =
  | { readonly state: 'none'; readonly sourceIds: readonly SourceId[] }
  | {
      readonly state: 'unknown';
      readonly reasons: readonly Reason[];
      readonly sourceIds: readonly SourceId[];
    }
  | {
      readonly state: 'required';
      readonly sourceIds: readonly SourceId[];
      readonly reasons: readonly {
        readonly code:
          | 'needs-review'
          | 'awaiting-answer'
          | 'manual-recovery'
          | 'reconcile-uncertain-operation';
        readonly message: string;
        readonly actionIds: readonly ActionId[];
      }[];
    };
export type StatusCode =
  | 'ready'
  | 'blocked'
  | 'implementing'
  | 'reviewing-code'
  | 'publishing'
  | 'needs-review'
  | 'ci-running'
  | 'ci-failed'
  | 'restacking'
  | 'conflict'
  | 'babysitting'
  | 'repairing-ci'
  | 'manual-recovery'
  | 'awaiting-answer'
  | 'continuation-pending'
  | 'launching'
  | 'cancelled'
  | 'landed'
  | 'unknown';
export interface WorkItem extends Entity<WorkItemId> {
  readonly subject:
    | { readonly kind: 'issue'; readonly issueId: IssueId }
    | {
        readonly kind: 'pull-request';
        readonly pullRequestId: PullRequestId;
        readonly issueIds: readonly IssueId[];
        /** Authoritative issue supplying priority/size/labels; null if ambiguous or absent. */
        readonly metadataIssueId: IssueId | null;
      };
  readonly section: 'planned' | 'working' | 'in-review' | 'unclassified';
  readonly status: {
    readonly code: StatusCode;
    readonly label: string;
    readonly active: boolean;
    readonly since: Timestamp | null;
  };
  readonly attention: Attention;
  readonly jobIds: readonly JobId[];
  readonly maintenanceIds: readonly EntityId<'maintenance'>[];
  readonly threadIds: readonly ThreadId[];
  readonly actionIds: readonly ActionId[];
}

export type Limit =
  | { readonly kind: 'unlimited' }
  | { readonly kind: 'limited'; readonly maximum: number };
/** Bounded projection: oldest pending notice, otherwise latest acknowledged notice. */
export interface FactoryPlanningState {
  readonly maximumAttempts: 3;
  /** Distinct automatic model deadline failures in this cycle, from zero to three. */
  readonly consecutiveModelDeadlineFailures: number;
  readonly pendingNoticeCount: number;
  readonly notice: PlanningFailureNotice | null;
}
export interface PlanningFailureNotice extends Entity<EntityId<'planning-notice'>> {
  readonly createdAt: Timestamp;
  readonly acknowledgedAt: Timestamp | null;
  /** One to three failures, oldest first. Appending reopens a seen notice revision. */
  readonly failures: readonly AutomaticModelDeadlineFailure[];
}
export interface AutomaticModelDeadlineFailure {
  readonly attemptId: string;
  readonly code: 'model-deadline';
  readonly message: string;
  readonly attemptStartedAt: Timestamp;
  readonly modelHandedOffAt: Timestamp;
  readonly deadline: Timestamp;
  /** Observed classification time; does not assert that the provider stopped then. */
  readonly failedAt: Timestamp;
  /** Actual elapsed intervals at failedAt, excluding later cleanup. */
  readonly attemptElapsedMs: number;
  readonly modelElapsedMs: number;
  readonly threadId: ThreadId | null;
  readonly runId: string | null;
}
export interface FactoryControl extends Entity<EntityId<'factory'>> {
  readonly planning: FactoryPlanningState;
  readonly paused: boolean;
  readonly concurrency: { readonly limit: Limit; readonly occupied: number };
  readonly admission: { readonly limit: Limit; readonly consumed: number };
  readonly actionIds: readonly ActionId[];
}
export type ActionKind =
  | 'configure'
  | 'start'
  | 'resume'
  | 'retry'
  | 'cancel'
  | 'preview-plan'
  | 'acknowledge-planning-failures';
export interface Action extends Entity<ActionId> {
  readonly kind: ActionKind;
  readonly targetId: IssueId | JobId | EntityId<'factory'>;
  readonly availability:
    | {
        readonly state: 'available';
        readonly precondition: string;
        readonly validUntil: Timestamp | null;
      }
    | { readonly state: 'disabled' | 'pending' | 'unknown'; readonly reasons: readonly Reason[] };
}

export interface PlanAttempt extends Entity<EntityId<'plan'>> {
  readonly startedAt: Timestamp;
  /** Model deadline, null until durable model handoff; not a discovery/freshness deadline. */
  readonly deadline: Timestamp | null;
  readonly finishedAt: Timestamp | null;
  readonly phase: 'discovery' | 'handoff' | 'freshness' | 'succeeded' | 'failed' | 'uncertain';
  readonly progress: string;
  readonly threadId: ThreadId | null;
  readonly basis: {
    readonly boardCursor: Cursor;
    readonly inputVersion: Version;
    readonly controlVersion: Version;
  };
  readonly applicability: 'current' | 'stale' | 'unknown';
  /** Advisory only. None of these edges grant admission or prerequisite readiness. */
  readonly result: {
    readonly selected: readonly {
      readonly issueId: IssueId;
      readonly reason: string;
      readonly dependsOn: readonly IssueId[];
      readonly conflicts: readonly IssueId[];
    }[];
    readonly deferred: readonly { readonly issueId: IssueId; readonly reason: string }[];
    readonly rejected: readonly { readonly issueId: IssueId; readonly reason: string }[];
  } | null;
}
export interface Tables {
  readonly repositories: Readonly<Record<RepositoryId, Repository>>;
  readonly sources: Readonly<Record<SourceId, Source>>;
  readonly users: Readonly<Record<UserId, User>>;
  readonly labels: Readonly<Record<LabelId, Label>>;
  readonly issues: Readonly<Record<IssueId, Issue>>;
  readonly pullRequests: Readonly<Record<PullRequestId, PullRequest>>;
  readonly relationships: Readonly<Record<EntityId<'relationship'>, Relationship>>;
  readonly stacks: Readonly<Record<EntityId<'stack'>, Stack>>;
  readonly threads: Readonly<Record<ThreadId, Thread>>;
  readonly jobs: Readonly<Record<JobId, Job>>;
  readonly maintenance: Readonly<Record<EntityId<'maintenance'>, Maintenance>>;
  readonly items: Readonly<Record<WorkItemId, WorkItem>>;
  readonly actions: Readonly<Record<ActionId, Action>>;
  readonly plans: Readonly<Record<EntityId<'plan'>, PlanAttempt>>;
}
export interface Coverage {
  readonly state: 'complete' | 'partial' | 'unavailable';
  readonly reasons: readonly Reason[];
  readonly unresolvedIssueIds: readonly IssueId[];
}
export interface BoardMeta {
  readonly dataMode: 'fake' | 'live';
  readonly coverage: Coverage;
  readonly diagnostics: readonly Reason[];
  readonly factory: FactoryControl;
  readonly currentPlanId: EntityId<'plan'> | null;
  readonly transport: {
    readonly changes: boolean;
    readonly events: boolean;
    readonly suggestedPollMs: number;
  };
}
export interface FactoryV2Snapshot {
  readonly apiVersion: 2;
  readonly scopeId: string;
  readonly cursor: Cursor;
  /** Time this projection revision was committed, not the time of every GET. */
  readonly committedAt: Timestamp;
  readonly meta: BoardMeta;
  readonly entities: Tables;
}
/** Whole-entity replacements and explicit removals. Apply a complete batch atomically. */
export type EntityChange = {
  [Table in keyof Tables]:
    | {
        readonly table: Table;
        readonly operation: 'upsert';
        readonly entity: Tables[Table][keyof Tables[Table]];
      }
    | { readonly table: Table; readonly operation: 'remove'; readonly id: keyof Tables[Table] };
}[keyof Tables];
export interface FactoryV2Delta {
  readonly apiVersion: 2;
  readonly scopeId: string;
  readonly fromCursor: Cursor;
  readonly toCursor: Cursor;
  readonly committedAt: Timestamp;
  readonly changes: readonly EntityChange[];
  /** Replace when present; omission means unchanged, never clear. */
  readonly meta?: BoardMeta;
}
export type FactoryV2Changes =
  | { readonly kind: 'unchanged'; readonly cursor: Cursor }
  | {
      readonly kind: 'changes';
      readonly batches: readonly FactoryV2Delta[];
      readonly nextCursor: Cursor;
      readonly hasMore: boolean;
    }
  | {
      readonly kind: 'resync-required';
      readonly reason: 'expired' | 'different-scope' | 'reset' | 'slow-consumer';
    };
export type FactoryV2Event =
  | { readonly event: 'change'; readonly id: Cursor; readonly data: FactoryV2Delta }
  | {
      readonly event: 'resync-required';
      readonly data: Extract<FactoryV2Changes, { kind: 'resync-required' }>;
    };

/** Copy actionId and precondition from an available Action. The server must still
 * validate current state. commandId is a client UUID reused for an uncertain retry.
 */
export type FactoryV2Command = {
  readonly commandId: string;
  readonly actionId: ActionId;
  readonly precondition: string;
} & (
  | {
      readonly kind: 'configure';
      readonly payload: {
        readonly paused: boolean;
        readonly concurrency: Limit;
        readonly admissionAllowance: Limit;
      };
    }
  | { readonly kind: 'start'; readonly payload: { readonly context: string } }
  | {
      readonly kind:
        | 'resume'
        | 'retry'
        | 'cancel'
        | 'preview-plan'
        | 'acknowledge-planning-failures';
      readonly payload: Record<string, never>;
    }
);
export interface FactoryV2CommandReceipt {
  readonly commandId: string;
  readonly version: Version;
  readonly actionId: ActionId;
  readonly state: 'accepted' | 'running' | 'succeeded' | 'rejected' | 'uncertain';
  readonly acceptedAt: Timestamp;
  readonly completedAt: Timestamp | null;
  readonly reasons: readonly Reason[];
  readonly result: { readonly jobId: JobId } | { readonly planId: EntityId<'plan'> } | null;
  readonly resultingCursor: Cursor | null;
}
export interface FactoryV2ItemDetails {
  readonly apiVersion: 2;
  readonly itemId: WorkItemId;
  readonly itemVersion: Version;
  readonly observedAt: Timestamp;
  readonly questions: readonly {
    readonly jobId: JobId;
    readonly id: string;
    readonly text: string;
  }[];
  readonly checkRuns: Fact<
    readonly {
      readonly id: string;
      readonly groupId: string;
      readonly name: string;
      readonly url: string | null;
      readonly comparison: EvidenceComparison;
      readonly state: CheckGroup['state'];
      readonly startedAt: Timestamp | null;
      readonly completedAt: Timestamp | null;
    }[]
  >;
}
export interface FactoryV2IssueSearch {
  readonly apiVersion: 2;
  readonly query: string;
  readonly nextPageToken: string | null;
  readonly coverage: Coverage;
  readonly sources: Tables['sources'];
  readonly hits: readonly { readonly issue: Issue; readonly startAction: Action }[];
  readonly users: Tables['users'];
  readonly labels: Tables['labels'];
  readonly repositories: Tables['repositories'];
}
export interface FactoryV2PlanDetails {
  readonly apiVersion: 2;
  readonly attempt: PlanAttempt;
  readonly entities: Pick<
    Tables,
    'issues' | 'repositories' | 'labels' | 'users' | 'sources' | 'threads'
  >;
}
export interface FactoryV2Problem {
  readonly type: string;
  readonly status: number;
  readonly code:
    | 'invalid-request'
    | 'unavailable'
    | 'not-found'
    | 'stale-action'
    | 'id-reused'
    | 'command-rejected'
    | 'unsupported'
    | 'origin-rejected';
  readonly title: string;
  readonly detail: string;
  readonly retry: 'refresh' | 'observe-command' | 'later' | 'never';
  readonly commandId: string | null;
}
