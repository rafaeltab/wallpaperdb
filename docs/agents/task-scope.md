# Task scope

Establish scope from the user's request, selected issue or spec, and prior user decisions. Automatic pickup and workflow instructions to fix findings authorize work within those boundaries.

## Decide whether approval is needed

Continue routine implementation choices and repairs needed to meet agreed requirements without another approval round.

Ask before changing requirements, observable behavior, supported environments, dependencies, architectural commitments, or guarantees beyond the user's authorization. Diff size and a reviewer's recommendation do not determine scope.

Investigate first so the user can assess a concrete proposal. If the boundary is uncertain, explain the disputed choice before implementing it.

## Propose a scope change

Explain the proposed change, why it is needed, its consequences and tradeoffs, and which work depends on the answer. Wait for explicit approval of that expansion while continuing independent authorized work. Silence, repeated feedback, and automatic pickup are not approval.

Apply the answer only to the proposal it covers. Retain declined or deferred proposals and report resulting limitations or unmet workflow gates. Distinguish a finding's factual validity from authorization to implement its solution. Do not report deferred work as fixed or an unmet gate as passed.

## Retain decisions and pass context

Keep scope, approvals, exclusions, pending proposals, and dependent work in the workflow's session record or ledger. Restore them on resume, monitoring wakes, and new review rounds. Follow [documentation guidance](../../AGENTS.md#documentation) for durable tracking and temporary notes.

Pass this context to delegated workers and reviewers, including replacements. Workers return scope proposals to the coordinator; reviewers identify out-of-scope recommendations as proposals. Reconcile findings with retained user decisions before assigning fixes.

Repeated suggestions do not reopen a decision. If new evidence warrants reconsideration, explain what changed and request a new decision before expanding the work.
