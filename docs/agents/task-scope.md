# Task scope

This is the authoritative scope policy for repository agent workflows. Establish the agreed task from the user's request, selected issue or spec, and existing user decisions. Automatic pickup authorizes the selected task within those boundaries. Workflow instructions to fix findings or complete work operate within this scope.

## Decide whether approval is needed

Continue routine implementation decisions and necessary repairs within the agreed task without another approval round. This includes correcting an implementation that fails an agreed requirement and choosing internal details that preserve the agreed behavior and commitments.

A significant scope change alters requirements, externally observable behavior, supported environments, dependencies, architectural commitments, or guarantees beyond what the user already authorized. Diff size does not determine scope. A one-line change can add a new guarantee; a large internal repair can preserve the agreed task. A concern's factual validity and a reviewer's recommendation do not authorize its proposed solution.

Investigate concerns and prepare concrete proposals within the existing authorization. Keep implementation that depends on a significant scope change pending until the user explicitly approves it. When the boundary is uncertain, investigate enough to explain the choice, then ask before implementing the disputed change.

## Propose a scope change

Present the concrete proposed change, why it is needed, and its consequences, including affected behavior, commitments, dependencies, and tradeoffs. Identify which work depends on the answer. Wait for the user's explicit answer before implementing that expansion; silence, repeated feedback, and automated pickup are not approval. Continue independent authorized work while the decision is pending.

Apply the user's answer to the proposal it covers. Retain declined or deferred proposals as such, and report any resulting limitation or unmet workflow gate honestly. A valid concern can remain outside the authorized task; record its factual assessment separately from its implementation disposition. Never report deferred work as fixed or an unmet validation or review gate as passed.

## Retain decisions and pass context

Keep the agreed scope, user approvals and exclusions, pending proposals, and work that depends on them in the workflow's existing session record or ledger. Follow the [documentation policy](../../AGENTS.md#documentation) for durable issue tracking and temporary notes. Restore this context before acting after a resumed session, monitoring wake, or new review round. Repeated suggestions do not supersede a user decision or reopen implementation. If new evidence warrants reconsideration, explain what changed and request a new decision before implementing the expansion.

Pass the agreed scope, relevant user decisions, pending proposals, and dependent work to delegated workers and reviewers, including replacement or repeated review rounds. Workers stay within that authorization and return new scope proposals to the coordinating agent for the user's decision. Reviewers may report concerns beyond scope, but identify them as proposals rather than required implementation. Reconcile their findings with the retained decisions before assigning fixes.
