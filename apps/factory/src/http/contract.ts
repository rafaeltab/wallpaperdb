/** Current explicit prerequisite edges, observed for the displayed admitted issue set. */
export interface WorkRelationship {
  readonly issue: number;
  readonly blockers: readonly number[];
}

/** Operations read contract for the factory composition:
 * GET /api/scheduler returns current local state/revision, admitted jobs,
 * localWork (current intent/control records), last-known recoveries, dated
 * observations and last-known explicit blocker relationships.
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
 * reconciliation. Planning-attempt submission/observation contracts remain in
 * capabilities/plan; this layer adds no deadline or phase changes.
 */
export type OperationsObservation = import('../capabilities/observe/index.js').ObservationState;
