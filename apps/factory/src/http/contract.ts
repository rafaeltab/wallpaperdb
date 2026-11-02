/** Current explicit prerequisite edges, observed for the displayed admitted issue set. */
export interface WorkRelationship {
  readonly issue: number;
  readonly blockers: readonly number[];
}
