# Factory host operations

Use the existing Linux host and authenticated headless T3 installation. The service uses the host user manager, not the desktop or a product container. Read the [configuration template](.env.example) and [Make interface](../../Makefile). Keep credentials private and restrict the listener to loopback or the existing tailnet IP. No public ingress is supported.

## Install and activate

Run `make install` and `make toolchain` in a clean, committed source checkout. Run `make run PACKAGE=factory SCRIPT=service:install ARGS='/absolute/releases'`. The [installer](scripts/install.mjs) builds that commit, copies the built application and resolved dependencies into a separate commit-named directory and records commit, tree, lock digest and Node executable in `installation.json`. Keep that pinned Node installation available. Never edit an installed release. An existing release is retained rather than overwritten.

Create private configuration and state directories outside the releases. Copy the environment template to a private `factory.env`, fill the project path, pinned comparison and target branch, exact installed T3 binary, and host tailnet IP with an unused port. Set exactly one unquoted `FACTORY_STATE=/absolute/state` assignment. Duplicate or overriding assignments are rejected before the active unit changes. Preserve the installed T3 host and unrelated listeners. Verify its headless CLI supports worktree/model selection before admitting work. MCP question observation and cancellation also require a dedicated authenticated MCP client as described in the [workspace guide](README.md).

Verify `systemctl --user is-system-running` and `loginctl show-user "$USER" -p Linger`. Lingering must already be enabled for operation after logout. Do not change global host policy as part of activation.

Run `make run PACKAGE=factory SCRIPT=service:activate ARGS='/absolute/releases/COMMIT /absolute/config/factory.env /absolute/state wallpaperdb-factory-NAME'`. The [activation command](scripts/activate.mjs) checks state compatibility before replacing its dedicated user unit and explicitly restarting it. It enables only the named unit. Check `systemctl --user status wallpaperdb-factory-NAME`, its journal, and `http://zerotwo:PORT/health`. A running manager alone does not prove application health. Inspect startup errors and correct configuration or dependency availability before resuming admission.

## Upgrade and recovery

Install the desired committed version alongside the old release. Run the same activation command with its new commit path and the same configuration, state and service identity. The operation restarts the factory without waiting for every external worker to finish. It does not cancel T3 workers. The service lock excludes overlapping service processes using that state directory. Direct development launches do not take this lock; do not mix them with the installed service on the same state.

Startup accepts immutable format-1 records, including older directories without a manifest, and adds the format marker without rewriting their claims. Unsupported formats fail before any external observation or admission. There is no destructive migration in this version. Preserve the entire state directory, including reservations, launch/delivery claims, waiting deadlines, planner associations and stack journals. Never delete a claim to retry an uncertain operation. Roll back only to an installation compatible with the retained format. Before activation, retain the old unit and release for recovery from host or configuration failures.

After restart inspect the dashboard's existing jobs and controls. The service reconciles external observations against durable records before advancing work. Unknown non-idempotent launch or send outcomes remain visibly pending for operator investigation. Availability of GitHub, T3 and the local filesystem remains necessary for reconciliation. Neither restart nor the native stack tool provides cross-resource atomicity, external cancellation completion, or universal exactly-once execution.

## Controlled rollout and daily use

Start with concurrency one and one distinct admission. Preview the semantic plan or deliberately select an eligible issue with retained scope context. Observe the issue, stage, elapsed time and issue/T3/PR links. Pause admissions while current work continues, adjust limits with the current revision, and explicitly resume parked work only after answering in its T3 thread. Removing readiness does not cancel active work. Cancellation is a distinct explicit control.

Use controlled external protocol endpoints and isolated Git/state when demonstrating this workflow without authorized real implementation/model/PR side effects. Label synthetic issue/PR identities and operator-asserted acceptance/reviews. Such a demonstration proves the installed production service and UI integration; it does not establish live model correctness or default-branch landing.

Implementation, independent Standards/Spec/Defects review, publication and current-tree CI remain separate stages. SIMPLE restacks require current-tree CI; COMPLEX changes require independent review-loop and CI. Required acceptance/review/CI must bind the actual current comparison before dependents proceed. Factory-ready PRs are handed back for manual merge; issues remain open until verified default-branch landing. Mutation and hosted model/security feedback are advisory. Preserve `$do-work` for manual single-issue work and `$babysit-pr` for repairs. Complete-spec acceptance remains a separate coordinator responsibility.

## Retention and retirement

Keep the active release, configuration, complete durable state and its owned unit for acceptance and recovery. Inspect logs with `journalctl --user -u wallpaperdb-factory-NAME`. Stop and disable only that unit with `systemctl --user disable --now wallpaperdb-factory-NAME` when retiring it. Remove only its unit after retaining its release identity and state backup, then reload the user manager. Stop the service before a filesystem backup. Retain old releases until compatibility and recovery have been checked; never silently delete useful demonstration state or unrelated services.

## Availability monitoring

For a monitored installation, set `FACTORY_OTEL_ENDPOINT` to the existing LGTM collector's OTLP HTTP endpoint. The factory exports `factory_scheduler_healthy` and `factory_scheduler_observed_at_seconds` through `/v1/metrics` every ten seconds, using a runtime-owned metric registry. A completed scheduler observation reports healthy or failed and its timestamp. Idle, paused and question-waiting observations succeed; a technical failure blocking reconciliation reports unhealthy even while `/health` remains live. A stuck observation stops advancing the timestamp. Export requests and shutdown are bounded; telemetry remains optional and does not control admission outcomes.

The [factory Grafana rules](../../infra/grafana/provisioning/alerting/factory.yaml) use the existing Prometheus data source. The [infrastructure Compose service](../../infra/docker-compose.yml) mounts the alerting provisioning directory into LGTM. One rule detects failed reconciliation; the other detects observations older than two minutes or absent for five minutes, with a further two-minute pending period. A stale observation can mean a long-running reconciliation; inspect the owning operation before intervention. These are monitoring thresholds, not workflow deadlines or retry authorization.

When deploying the combined source, provision the rules in the existing monitoring installation, configure the factory's collector endpoint, and verify samples and alert state through that installation's established notification routing. Confirm healthy observations, then inspect failure and missing-signal conditions without sending real notifications during a controlled check. A source file or controlled collector test alone does not establish a running alert or notification delivery. Do not restart or modify an unrelated monitoring installation to apply a ticket repair.

With `FACTORY_OTEL_ENDPOINT` absent, the factory exports neither traces nor metrics, including when a generic OTLP environment variable is present. Intentionally unmonitored operation must disable the factory missing-signal rule in the monitoring configuration; absent data cannot distinguish that choice from process loss. Leave the rule enabled for deployments expected to be monitored. Keep collector credentials and filesystem paths out of metric labels.
