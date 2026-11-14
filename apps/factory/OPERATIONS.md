# Factory host operations

## Host prerequisites

The host's user manager must remain available after logout. Verify that lingering is enabled before activation; changes to host policy belong to the supervising operator.

Retain the active release's pinned Node installation, private configuration and dedicated user unit until recovery has been verified. The [installer](scripts/install.ts) records the executable path; moving or removing that installation can break an otherwise intact release.

## Upgrade and recovery

Stop all writers and back up the entire state directory, including database journals, before migration or restoration. Retain the previous release, unit and private configuration. Verify copied production state through the [migration-only entry point](src/main.ts). Starting a full factory against that copy can contact retained external workers even while admissions are paused. Development and demonstrations need isolated state and controlled external endpoints.

The ordered-receipt protocol retains existing stage records, claims and provider observations. Outstanding pre-upgrade receipts reconcile against their original factory instructions and pinned comparison without a new launch or delivery; absent or ambiguous transcript evidence stays pending. New stage records carry `receiptProtocol: "delivery-v1"` and require an explicit delivery identity. Provider-ID observation records coexist with legacy ordinal records. These are additive records in the existing SQLite journal, with no relational schema change. After the journal advances, use a release that understands these fields for rollback; an older strict parser may reject them. Never remove records or restore stale JSON to make an older release start. See the [completion contract](README.md#completion-and-ordering) and [record schemas](src/platform/record-schemas.ts).

After the factory performs external work newer than a backup, restoring that backup can discard claims for work that still exists. Preserve the current state and use a compatible release. Restore an older backup only after the supervising operator reconciles every subsequent external effect. After JSON-to-SQLite migration, legacy JSON files are historical originals, not a current backup. Do not delete records or fields to make an older release accept newer state.

The installed service's lock does not protect against direct development launches. Keep those launches away from the service's state directory.

## Operator-attested recovery

A missing thread search result cannot prove that a launch failed. Retiring an uncertain planner claim requires explicit server evidence of non-launch. For the supported T3 `-32602` rejection recovery, the supervising operator must stop the service, retain a complete backup and supply the evidence reference and timestamp to the [reconciliation command](src/main.ts). Deployment and this attestation remain supervisor actions.

## Monitoring

Provision the [factory alert rules](../../infra/grafana/provisioning/alerting/factory.yaml) in the actual monitoring installation and verify its notification routing. Repository configuration alone does not prove deployment or delivery. Use controlled checks without real notifications unless authorized, and preserve unrelated monitoring services.

An intentionally unmonitored factory needs its missing-signal alert disabled in that installation. Missing data cannot distinguish that choice from process loss.

## GitHub project membership

The WallpaperDB project's auto-add workflow must continue adding every repository issue and PR. This external workflow is a prerequisite for [project-based metadata discovery](src/adapters/github/project-sync.ts).
