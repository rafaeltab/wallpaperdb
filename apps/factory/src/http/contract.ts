/** Current explicit prerequisite edges, observed for the displayed admitted issue set. */
export interface WorkRelationship {
  readonly issue: number;
  readonly blockers: readonly number[];
}

/** Operations read contract for the factory composition:
 * GET /api/scheduler returns current local state/revision, admitted jobs,
 * localWork (current intent/control records), last-known recoveries, dated
 * observations and last-known explicit blocker relationships.
 * GET /api/threads returns an independently dated local T3 metadata snapshot;
 * scheduler.threads embeds the same contract. Thread createdAt/updatedAt are
 * source timestamps or null, separate from observedAt and per-association dates.
 * Branch/worktree and issue associations use explicit retained factory bindings
 * or T3 PR links plus GitHub closing references. Missing evidence is unavailable
 * or absent; contradictory bindings remain conflicting. No title inference.
 * Optional browserOrigin reflects configured Connect access; identity comes
 * from the supported environment protocol, never a service runtime-state id.
 * GET /api/job returns the first admitted job or empty, from that same local view.
 * GET /api/observations returns the dated observation envelope. Its state is
 * initial/loading/current/stale/error; facts are absent until a complete refresh.
 * GitHub facts include candidate/context issues, all open PRs and related closed
 * PRs. linkedIssues are explicit closing references; crossReferencedIssues are
 * weaker timeline evidence. Branch names/OIDs retain possible stack relations,
 * without guessing issue/thread ownership. Review/CI evidence names its head.
 * jobsObservedAt dates cached worker/delivery/recovery facts; localWork remains
 * authoritative for persisted controls. An unobserved worker is ambiguous.
 * POST commands retain their existing request/results and revision CAS. A saved
 * scheduler command returns a fresh local control revision. Reads do no external
 * reconciliation. The React frontend polls JSON snapshots, retains editor drafts
 * with their captured revision, and releases polling when its page lifetime ends.
 * Planning-attempt submission/observation contracts remain in
 * capabilities/plan; this layer adds no deadline or phase changes.
 */
export type OperationsObservation = import('../capabilities/observe/index.js').ObservationSnapshot;
export type OperationsSnapshot = import('../capabilities/observe/index.js').ScheduleSnapshot;
