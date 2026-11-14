# Factory host operations

## Host prerequisites

The host's user manager must remain available after logout. Verify that lingering is enabled before activation; changes to host policy belong to the supervising operator.

Retain the active release's pinned Node installation, private configuration and dedicated user unit until recovery has been verified. The [installer](scripts/install.ts) records the executable path; moving or removing that installation can break an otherwise intact release.

Completion verification requires the structured T3 MCP connection configured in the [composition root](src/composition/implementation.ts). CLI transcript output alone cannot establish descendant inactivity or registered waits. Missing connection or activity evidence leaves completion unverified.

## Upgrade and recovery

Stop all writers and back up the entire state directory, including database journals, before migration or restoration. Retain the previous release, unit and private configuration. Verify copied production state through the [migration-only entry point](src/main.ts). Starting a full factory against that copy can contact retained external workers even while admissions are paused. Development and demonstrations need isolated state and controlled external endpoints.

The state-response protocol preserves existing stage records, claims and provider observations. An idle old-format agent receives one migration instruction to verify current state using the versioned contract. The factory never accepts legacy success. A failed migration requires maintainer intervention. Reconciliation claims retain attempts and the pending instruction atomically in the existing SQLite journal. These additive [record fields](src/platform/record-schemas.ts) require a compatible release for rollback. Never remove records or restore stale JSON to make an older release start.

Configure the per-job Agent reconciliation attempt limit with `FACTORY_AGENT_RECONCILIATION_LIMIT`, default three, in the [composition configuration](src/composition/implementation.ts). Changing stages or restarting the service preserves consumed attempts. A lost send response retains its claim and is not resent. Exhausted budgets and failed migrations appear as manual recovery. An operator can explicitly reset through the [job resume endpoint](src/http/implementation.ts) using the exact job, stage index, owning run and control revision with `resetReconciliation: true`. This preserves claims and history and rechecks current state; it cannot resume a cancelled job. Deployment and live operator recovery remain supervisor actions.

After the factory performs external work newer than a backup, restoring that backup can discard claims for work that still exists. Preserve the current state and use a compatible release. Restore an older backup only after the supervising operator reconciles every subsequent external effect. After JSON-to-SQLite migration, legacy JSON files are historical originals, not a current backup. Do not delete records or fields to make an older release accept newer state.

The installed service's lock does not protect against direct development launches. Keep those launches away from the service's state directory.

## Operator-attested recovery

A missing thread search result cannot prove that a launch failed. Retiring an uncertain planner claim requires explicit server evidence of non-launch. For the supported T3 `-32602` rejection recovery, the supervising operator must stop the service, retain a complete backup and supply the evidence reference and timestamp to the [reconciliation command](src/main.ts). Deployment and this attestation remain supervisor actions.

## Monitoring

Provision the [factory alert rules](../../infra/grafana/provisioning/alerting/factory.yaml) in the actual monitoring installation and verify its notification routing. Repository configuration alone does not prove deployment or delivery. Use controlled checks without real notifications unless authorized, and preserve unrelated monitoring services.

An intentionally unmonitored factory needs its missing-signal alert disabled in that installation. Missing data cannot distinguish that choice from process loss.

## GitHub project membership

The WallpaperDB project's auto-add workflow must continue adding every repository issue and PR. This external workflow is a prerequisite for [project-based metadata discovery](src/adapters/github/project-sync.ts).

Dependency responses use the shared versioned agent protocol. The [job handback transition](src/capabilities/job/handback.ts) validates prerequisites before instructing the existing idle agent to record GitHub blockers, close its abandoned PR and restore the open issue to Planned. Invalid identities use the reconciliation budget; cycles require manual recovery. Missing authoritative verification retains ownership rather than assuming an uncertain write failed. The [scheduler](src/capabilities/plan/scheduler.ts) releases admission and allowance together only after verified handback, retaining abandoned admission evidence. The [guarded persistence operation](src/adapters/store/handback.ts) checks the exact owning job identity and the uncancelled revision that verified handback in the same SQLite transaction as release. The transaction also marks the old journal terminal, so cancellation or supersession invalidates stale observations and old in-flight work cannot authorize another instruction after refund. Informational status rereads cannot replace the verified revision. Future ordinary pickup obeys dependencies and capacity and uses a fresh job and journal generation. Cancellation alone does not refund allowance. Preserve all generations and their threads, worktrees and branches during recovery.
