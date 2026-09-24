# Duplicate utility proposal — ready for review

External draft only. Nothing applied to the worktree or running services.

The proposed module/tests and unapplied new-files patch are saved. All6 offline tests passed; see DESIGN.md and test-output.txt. No service validation has run.

Correction: group identical complete utility fields and move multiplicity into field_value_factor.factor (count / original target count). Different percentages remain different utilities. Distinct-target queries return the original body unchanged. Proposed bounded wrapper delegates unchanged distinct-target queries; duplicate queries use a complete unbounded corrected OpenSearch query, avoiding unproven reuse of the old float threshold.

15-column browser QA completed separately. Next: root review and explicit scheduling of real-service validation during an appropriate correctness window. Existing runtime sources remain unchanged.
