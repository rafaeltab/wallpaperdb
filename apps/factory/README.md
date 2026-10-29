# Factory operations

Repository-owned operational infrastructure for deliberately starting and observing one implementation job. It is separate from the WallpaperDB product and runs on the host so it can use the existing authenticated GitHub and headless T3 installation.

## Capabilities

A maintainer selects one trusted ready issue and can narrow its execution with context. The factory durably reserves the admission and expected implementation stage, requests a dedicated T3 thread/worktree using gpt-6.1-sol, and shows stage, elapsed time and issue/thread links. Launch uncertainty preserves the reservation and reconciles the exact job identity instead of launching twice. A completed turn never establishes implementation acceptance.

## Operating constraints

Use the shared [checkout guide](../../CONTRIBUTING.md) and workspace scripts. Configure the pinned base, active T3 binary and private state directory in the [environment template](.env.example) before starting. The active installation must support headless thread start/list/show with worktree/model selection; the PATH launcher may be older. Startup checks the installed interface without upgrading or restarting T3. Bind only loopback or the host's tailnet address and restrict access to maintainers with tailnet ACLs. The HTTP interface deliberately has no public Internet deployment or product ingress.

State uses immutable, fsynced files and atomic hard links on a local Linux filesystem. Its parent directory must already exist and be durable; keep state outside the checkout/install directory. Do not remove a reservation to retry an uncertain launch. An interrupted launch can remain uncertain indefinitely when T3 cannot establish its identity. This favors avoiding duplicate workers over automatic retry.

Open blockers require explicit operator assertions of previously verified acceptance, independent reviews and applicable CI at the configured prerequisite commit. The adapter rechecks the live PR head and inclusion in the selected base; it does not infer readiness from an open PR. These assertions are not planning or autonomous readiness discovery. Closed blockers need no assertion. Project status is reporting and does not trigger admission. The service does not claim or change issue lifecycle state.

Only one total admission is supported. Automatic discovery, planning, additional admissions, review dispatch, publication, CI orchestration, upgrades and resets remain unavailable. Questions and results stay in T3. Follow-up slices own those controls and acceptance transitions.

Optional OTLP HTTP tracing uses a factory-owned provider and propagates inbound trace context. It does not register global product telemetry. Export sockets have bounded cleanup. Shutdown allows five seconds for HTTP requests, then closes their connections and cancels outstanding CLI subprocesses; external T3 workers and durable reservations remain intact.
