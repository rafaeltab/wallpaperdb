# Local sandbox and Docker security boundary

**Decision for issue [#183](https://github.com/rafaeltab/wallpaperdb/issues/183):** run the one unattended OpenCode worker in a **disposable, hardware-virtualized Linux VM** on the local machine. Keep the repository checkout, Sandcastle process, application processes, and a conventional Docker Engine **inside that VM**. The guest Docker socket may be available to the worker because the VM—not the worker container—is the security boundary. Never pass the host's `/var/run/docker.sock`, host network namespace, canonical checkout, or sibling-workload networks into the guest.

This is a research recommendation, not an implementation. Facts below are deliberately labeled as repository facts, prior measurements, or recommendations.

## Decision drivers

The required worker must be able to do all of the following without operator intervention:

1. edit and commit a complete worktree;
2. start the full Compose application;
3. run unit, Testcontainers integration, service-image E2E, and browser E2E tests;
4. build and run arbitrary repository Dockerfiles; and
5. fail, time out, or be compromised without gaining uncontrolled access to `zerotwo`, the canonical checkout, or sibling workloads.

The compatibility requirement rules out treating a service endpoint broker or a build-only API as a drop-in Docker replacement. The security requirement rules out the current shared rootful Docker socket.

## Repository facts (revision `b078ea7`)

- WallpaperDB pins `@ai-hero/sandcastle` 0.10.0 in the lockfile ([`pnpm-lock.yaml:12-16`](../../pnpm-lock.yaml#L12-L16)). Sandcastle's Docker provider is a bind-mount provider: it mounts the worktree and Git paths and supports user mounts, networks, supplementary groups, devices, and a CPU limit ([upstream v0.10.0 source](https://github.com/mattpocock/sandcastle/blob/v0.10.0/src/sandboxes/docker.ts#L37-L124), [container creation](https://github.com/mattpocock/sandcastle/blob/v0.10.0/src/sandboxes/docker.ts#L147-L199)). It is orchestration, not an additional hypervisor boundary.
- The current configuration sets `network: "host"`, mounts `/var/run/docker.sock` read-write, adds the host Docker group, and sets `DOCKER_HOST` to that socket ([`.sandcastle/sandbox.ts:7-31`](../../.sandcastle/sandbox.ts#L7-L31)). Its readiness hook confirms access to the daemon ([`.sandcastle/sandbox.ts:34-43`](../../.sandcastle/sandbox.ts#L34-L43)).
- The sandbox image explicitly says `make ci`, Testcontainers, Compose, and development commands use the **direct host Docker daemon** ([`.sandcastle/Dockerfile:13-23`](../../.sandcastle/Dockerfile#L13-L23)). The worker itself is non-root, but Docker-group membership makes that irrelevant to daemon authority.
- Two long-lived secrets are supplied to the worker: OpenCode auth and the WallpaperDB config directory are read-only bind mounts, while `GH_TOKEN` is injected as an environment variable ([`.sandcastle/sandbox.ts:12-30`](../../.sandcastle/sandbox.ts#L12-L30)). Repository setup then materializes ignored per-app `.env` files ([`.sandcastle/README.md:7-31`](../../.sandcastle/README.md#L7-L31)). Read-only mounting prevents direct writes to the source mount; it does not prevent exfiltration by a compromised worker.
- Compose is a first-class interface. `make infra-start`, `make apps-start`, and `make dev` invoke two Compose files, and `make dev` uses Compose Watch ([`Makefile:43-46`](../../Makefile#L43-L46), [`Makefile:237-275`](../../Makefile#L237-L275), [`Makefile:758-763`](../../Makefile#L758-L763)). The infrastructure stack includes PostgreSQL, MinIO, OpenSearch, NATS, Redis, observability, and administration services; the app stack builds and runs the services and web frontend.
- Integration tests create Docker networks and runtime containers through Testcontainers rather than merely connecting to pre-provisioned endpoints. For example, the shared tester creates a random Docker network ([`DockerTesterBuilder.ts:26-44`](../../packages/test-utils/src/builders/DockerTesterBuilder.ts#L26-L44)); custom NATS and OpenSearch implementations create and start containers and expose mapped ports ([`nats.ts:102-152`](../../packages/testcontainers/src/containers/nats.ts#L102-L152), [`opensearch.ts:60-104`](../../packages/testcontainers/src/containers/opensearch.ts#L60-L104)).
- The CI surface runs build, lint, type checking, unit tests, integration tests, sequential E2E, and coverage merge ([`Makefile:816-838`](../../Makefile#L816-L838)). Browser E2E is Playwright-based and verifies an externally started application environment ([`apps/web-e2e/package.json:6-9`](../../apps/web-e2e/package.json#L6-L9)). Service E2E also builds and runs images.
- Worktree setup namespaces Compose project names and allocates host ports by slot ([`scripts/setup-worktree.mjs:127-190`](../../scripts/setup-worktree.mjs#L127-L190)). This reduces accidental collisions; it is not authorization. The current cleanup can enumerate and force-remove containers, networks, and volumes through the shared daemon and matches names containing the project slug ([`.sandcastle/docker-resources.ts:13-21`](../../.sandcastle/docker-resources.ts#L13-L21)).
- The Compose repository also contains AppArmor-unconfined overrides for every infrastructure and application service ([`infra/docker-compose.apparmor-unconfined.yml`](../../infra/docker-compose.apparmor-unconfined.yml), [`infra/docker-compose.apps.apparmor-unconfined.yml`](../../infra/docker-compose.apps.apparmor-unconfined.yml)). They are not selected by the Makefile defaults, but a worker with daemon authority can select them; outer isolation must not depend on inner AppArmor.

### Consequence of the current socket

Docker's official security guidance says only trusted users should control a rootful daemon: the API can create a container bind-mounting host `/` and alter the host filesystem without restriction ([Docker Engine security, daemon attack surface](https://docs.docker.com/engine/security/#docker-daemon-attack-surface)). Therefore the present socket grants the worker effective control over host containers, images, networks, volumes, bind mounts, and the host filesystem. `network: "host"` also removes the sandbox's network-namespace separation. **The current configuration packages a process; it does not satisfy the requested boundary.**

## Measured facts from the existing Lakebed report

These are measurements reported by the read-only Lakebed report source at `/home/rafaeltab/artifacts/wallpaperdb-ci-resource-report/client/index.tsx`; this investigation did not rerun the profile. They should not be confused with repository invariants or sizing guarantees.

- A cold forced phase A sampled about **17.9 GiB aggregate process RSS**, a **12.5 GiB fall in available memory**, **179 relevant processes**, and **2.53 GiB peak container memory**; OpenSearch accounted for about 1.59 GiB of the container peak ([report source lines 47-58](file:///home/rafaeltab/artifacts/wallpaperdb-ci-resource-report/client/index.tsx#L47-L58)). Aggregate RSS may double-count shared pages.
- The same report measured phase A at 46.88 seconds cold/forced and 1.16 seconds with 66/66 cache hits, so cache state dominates timing ([lines 74-80](file:///home/rafaeltab/artifacts/wallpaperdb-ci-resource-report/client/index.tsx#L74-L80)).
- Full browser E2E was not profiled because the local app stack was absent. The runnable ingestor E2E slice took 90.58 seconds, including a 56.71-second image build ([lines 95-98](file:///home/rafaeltab/artifacts/wallpaperdb-ci-resource-report/client/index.tsx#L95-L98)).
- The report's capacity conclusion was one exclusive forced full-CI or full-Compose/browser-E2E lane on the inspected roughly 28 GiB host ([lines 168-179](file:///home/rafaeltab/artifacts/wallpaperdb-ci-resource-report/client/index.tsx#L168-L179)).

These observations support one bounded worker and a VM memory floor; they do **not** prove that a 12.5 GiB VM is sufficient, because the browser stack was missing and guest/daemon overhead was not included.

## Option assessment

| Option | Runs current Compose, Testcontainers, image builds, and Playwright? | Isolation from host/siblings | Decision |
|---|---|---|---|
| Current Sandcastle container + host rootful socket and host networking | Yes | **None at the Docker/API and network boundary** | Reject |
| Host-managed Compose services; no Docker API in worker | App and browser paths can be brokered, but current integration/E2E tests create containers and networks themselves | Strong if the broker exposes only named operations/endpoints | Future optimization, not compatible today without test/orchestrator changes |
| Host rootless Docker daemon dedicated to the worker | Likely, subject to path identity, Ryuk, cgroup, networking, and Compose qualification | Better: daemon and containers run in a user namespace, but still share the host kernel and that Unix user's accessible files/network | Conditional interim/spike, not the primary hostile-code boundary |
| Rootless BuildKit only | Image builds only | Narrower build API; can be remote and rootless | Useful complement, not a runtime replacement |
| Privileged rootless/rootful Docker-in-Docker in the current host container | Usually | Outer `--privileged`/unconfined configuration weakens the host boundary | Reject on shared host |
| Disposable local KVM VM with Docker wholly inside | Yes; preserves ordinary Docker semantics | Guest kernel and VM boundary separate Docker authority from host Docker and siblings | **Choose** |
| Remote sandbox/VM | Only after proving nested Docker and resource/network requirements | Strong when dedicated and disposable | Fallback under explicit criteria |

### Why rootless Docker is not the primary boundary

Rootless Docker is worthwhile defense in depth. Docker documents that both daemon and containers run without host root in a user namespace ([rootless mode](https://docs.docker.com/engine/security/rootless/#how-it-works)). A dedicated Unix identity, socket (`/run/user/<uid>/docker.sock`), data root, and network would prevent the worker from controlling the normal rootful daemon.

It still requires qualification:

- subordinate UID/GID ranges and `newuidmap`/`newgidmap` are prerequisites ([Docker rootless prerequisites](https://docs.docker.com/engine/security/rootless/#prerequisites));
- CPU/memory/PID limits work only with cgroup v2 and systemd, and controllers may need explicit delegation ([rootless resource limits](https://docs.docker.com/engine/security/rootless/tips/#limiting-resources));
- Testcontainers supports selecting a daemon with `DOCKER_HOST` and has a separate socket override for Ryuk ([Testcontainers configuration](https://github.com/testcontainers/testcontainers-node/blob/main/docs/configuration.md#docker)); and
- the dedicated daemon must see Compose bind-mount source paths at the same absolute paths, while the daemon UID must not be the identity used by `zerotwo` or any sibling workload.

Even after those checks, arbitrary code and the daemon share the host kernel, and Docker's API can expose every file readable by that dedicated daemon user. Host firewall policy must also stop lateral access. That is materially better than the current socket, but a VM is a clearer fail-closed boundary for unattended arbitrary code.

### Why BuildKit is only a complement

The Buildx remote driver connects to an externally managed BuildKit daemon and supports mutual-TLS client credentials ([Docker remote driver](https://docs.docker.com/build/builders/drivers/remote/)). BuildKit can run rootless, though upstream notes rootless networking limitations and recommends isolating its network namespace ([BuildKit rootless](https://github.com/moby/buildkit/blob/master/docs/rootless.md#running-buildkit-in-rootless-mode-oci-worker)). This narrows image-building authority and can improve cache reuse, but it cannot create the Compose application stack or the runtime containers/networks required by Testcontainers. Do not give the worker a Docker socket merely to load a remotely built image; export to a registry or to the guest-owned daemon instead.

## Recommended local-first architecture

```text
zerotwo host (trusted controller only)
├── canonical repositories and sibling workloads (never mounted/reachable)
├── host Docker socket (never passed through)
└── disposable KVM/QEMU or Firecracker VM, one run
    ├── private copy/clone at pinned base SHA (not a host git worktree mount)
    ├── Sandcastle + OpenCode + short-lived scoped credentials
    ├── Docker Engine + BuildKit wholly inside guest
    ├── Compose/Testcontainers/app/browser containers wholly inside guest
    └── bounded disk, CPU, RAM, wall clock, and filtered virtual NIC
```

A VM supplies its own kernel, unlike a system/application container which shares the host kernel ([Canonical's container/VM comparison](https://github.com/canonical/lxd/blob/main/doc/explanation/instances.md#virtual-machines-vs-system-containers)). Firecracker explicitly targets VM workload isolation and treats guest vCPU code as malicious ([design and threat containment](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md#threat-containment)). Firecracker also explicitly does **not** filter guest traffic; filtering belongs on the host ([design lines 93-95](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md#L93-L95)). QEMU/KVM managed by Incus/LXD is an equally valid local implementation if it is easier to operate; the requirement is a hardware-virtualized guest, not a particular VMM.

### Controller and guest rules

1. **Copy, do not mount, the repository.** Create a fresh clone or transfer a Git bundle/tarball for the pinned base SHA. Do not 9p/virtiofs-mount the canonical checkout, its `.git` common directory, `$HOME`, `/tmp`, or a Docker data root. Export only commits/patches and test artifacts after validation.
2. **Keep Docker authority inside.** The guest can use rootful Docker for maximum compatibility because guest root stops at the VM boundary. There is no host `DOCKER_HOST`, host socket, or Docker TCP API. Rootless Docker inside the guest is optional defense in depth, not required for the host boundary.
3. **Use a private virtual network.** Default-deny routes to host loopback, link-local metadata (`169.254.169.254`), RFC1918/ULA ranges containing host and sibling workloads, the host Docker bridges, and management interfaces. Allow DNS and an explicit egress set needed for the model provider, GitHub, npm/pnpm, and image registries. Permit published application ports only to a controller-side health-check/browser proxy, never the LAN.
4. **Use capability-scoped, short-lived secrets.** Mint a per-run GitHub credential limited to the target repository and required operations; provide model credentials only in guest memory/environment. Do not copy the host OpenCode credential file or all of `~/.config/wallpaperdb`. Generate a run-specific config containing only development secrets. Revoke/delete on teardown and avoid persistent snapshots containing secrets.
5. **Bound denial of service.** Start qualification at **20 GiB RAM, 12 vCPU, 100 GiB sparse disk**, one VM only, and an outer wall-clock timeout. Reserve at least 6-8 GiB and several CPUs for the inspected 28 GiB host and its siblings. These are recommendations inferred from an incomplete profile, not measured minima. If 20 GiB cannot coexist safely with host workloads, use remote fallback rather than shrinking until tests OOM.
6. **Serialize heavy surfaces.** Preserve `--concurrency=1` for E2E and cap the broad build/unit/integration phase while qualifying. The controller must not admit another full CI/Compose workload concurrently.
7. **Fail closed and destroy.** On success, failure, timeout, controller restart, or worker loss: stop the VM, discard its writable disk and virtual NIC, revoke credentials, and verify no guest process/TAP/firewall lease remains. Do not trust in-guest cleanup as the final control.
8. **Treat output as untrusted.** Validate branch name, commit ancestry, patch size, and artifact paths before importing. Run a final trusted check of the commit metadata; never import a guest-created filesystem image or executable into the host controller.

### Compatibility acceptance test

The local VM architecture is ready only when a fresh guest, with no warm image or package cache unless explicitly declared, can demonstrate all of the following:

- `pnpm install --frozen-lockfile` and worktree environment generation succeed without host config mounts;
- `make infra-start`, `make apps-start`, application health checks, and `make dev`/Compose Watch work;
- `make test-unit`, `make test-integration`, `make test-e2e`, and browser E2E all execute against the guest daemon;
- at least one Testcontainers suite proves Ryuk cleanup, random mapped-port reachability, custom network creation, and OpenSearch startup;
- all repository service images build and can be loaded/run in the guest daemon;
- resource and wall-clock limits terminate a deliberate runaway process/container;
- guest attempts to reach the host Docker socket, host management address, metadata endpoint, `zerotwo`, and a sibling canary are denied;
- after forced VM termination, no VM, TAP, firewall lease, credential, or imported host file remains; and
- the resulting commit/patch can be exported without granting the guest access to the canonical checkout.

## Host-managed services: when to reconsider

A trusted host broker is attractive for cache efficiency, but it becomes safe only when the worker receives a narrow protocol such as `allocateStack(runId, profile)`, `runTestSurface(runId, target)`, `buildImage(runId, digest)`, and `destroy(runId)`—not a filtered general Docker API. Today, tests directly create arbitrary containers, networks, mapped ports, and cleanup resources, so a broker would either break them or recreate most Docker authority.

Reconsider the broker after repository-owned test fixtures can accept provisioned endpoint contracts and logical namespaces, image builds are routed to isolated BuildKit, every resource carries an immutable run label, and cleanup authorization is exact-label based rather than a name substring. Until then, the VM preserves semantics with a simpler security argument.

## Remote fallback criteria

Use a **dedicated disposable remote VM** with the same controls and guest image when any one of these is true:

1. local KVM is unavailable, nested virtualization is disabled, or the local VMM/kernel is outside its supported security-update window;
2. the controller cannot enforce network denial to host, sibling, management, and metadata ranges;
3. allocating the recommended guest resources would leave less than 6 GiB host memory headroom, or local pressure repeatedly triggers swapping/OOM/host unresponsiveness;
4. a cold qualified full run exceeds the local wall-clock budget (initially 30 minutes) twice, or guest disk/image-cache pressure exceeds the bounded local allocation;
5. the task requires untrusted third-party code, dependency behavior, or credentials whose impact exceeds the local host's risk tolerance; or
6. the local acceptance test above fails, especially Docker/Testcontainers compatibility or teardown containment.

Remote does not mean “any code sandbox.” The provider must supply a disposable VM-class boundary, enough memory/disk/vCPU, a Docker-compatible daemon or supported nested Docker, enforceable egress policy, short-lived credentials, artifact export, hard timeout, and deletion evidence.

Sandcastle 0.10.0 includes a Vercel provider whose source describes one ephemeral Firecracker microVM per run and exposes vCPU, timeout, port, and network-policy options ([upstream provider](https://github.com/mattpocock/sandcastle/blob/v0.10.0/src/sandboxes/vercel.ts#L65-L133)). Vercel's official CLI documents vCPU/memory coupling, hard timeouts, custom allow/deny network policies, and extended-privilege execution ([Vercel Sandbox CLI](https://github.com/vercel/sandbox/blob/main/packages/sandbox/docs/index.md#sandbox-run)). Those facts make it a candidate, **not an approved fallback**: the cited interface does not establish that WallpaperDB's nested Docker/Compose/Testcontainers surface works. Qualify the complete acceptance test before selecting it. Otherwise use a conventional dedicated cloud VM where Docker is explicitly supported.

## Final recommendation

Adopt **one disposable local KVM VM per unattended Sandcastle run, with the complete Docker control plane inside the guest**. The VM receives a private repository copy, minimal short-lived credentials, hard resource/time limits, and a host-filtered NIC; it receives no host mounts or host Docker access. Use rootless Docker/BuildKit as optional defense or build acceleration, not as substitutes for the VM boundary. Move to a similarly disposable remote VM when local isolation, resources, or qualification gates fail. Do not continue unattended operation with the current rootful host socket and host networking.
