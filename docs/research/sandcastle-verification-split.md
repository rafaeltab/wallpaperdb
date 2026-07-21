# Sandcastle verification split

**Decision for [issue #186](https://github.com/rafaeltab/wallpaperdb/issues/186)**

**Research baseline:** `b078ea7105f14f4044e5a7a46eab3b17ae4645ac` (`main`)

**Researched:** 2026-07-21

## Decision

Use **ticket-scoped verification in the sandbox before every PR creation or update**, and use **clean, complete, resource-bounded GitHub Actions lanes as the merge authority**.

The OpenCode worker must run the smallest set of checks that directly proves its change, including a real backend, a started application, or browser E2E whenever that is the surface changed by the ticket. It must not run `make ci` by default. GitHub Actions must remain responsible for the full repository graph, clean-environment reproducibility, merged-commit coverage, coverage upload, and the full system/browser gate.

This is a split by **scope**, not by **capability**:

- the sandbox is the fast diagnostic and ticket-proof environment;
- GitHub Actions is the complete merge gate;
- the sandbox must retain Docker, application startup, and browser capability so no ticket is forced to defer its only meaningful test to CI.

## Why this split

### The current blanket local gate is both expensive and unsound

Both implementation and review prompts currently require `make ci` before committing ([implementation prompt](../../.sandcastle/implement-prompt.md#L36-L39), [review prompt](../../.sandcastle/review-prompt.md#L53-L60)). That command runs build, lint, type-check, unit, real-backend integration, every E2E workspace, and coverage merge ([Makefile](../../Makefile#L816-L838)).

The measured cold, forced phase A had:

- **17.9 GiB** sampled process RSS;
- a **12.5 GiB** available-memory drop;
- **179** relevant processes;
- **2.53 GiB** peak container memory;
- **46.88 s** wall time versus **1.16 s** with 66/66 warm Turbo hits;
- **139 task-seconds** in integration tests.

The report attributes that peak to nested fan-out: Turbo starts workspace tasks while Vitest starts workers and Testcontainers starts infrastructure. It classifies one forced broad phase or one full Compose/browser stack as an exclusive heavy job; two simultaneous forced phase-A runs project to consume the host's available headroom.[^lakebed]

More importantly, `make ci` and `make ci-force` can return success after E2E failure. Their multi-line shell recipes use an `&&` chain, but unconditional successful `echo` commands follow that chain; GNU Make sees the final shell status rather than the failed intermediate command ([Makefile](../../Makefile#L816-L838)). Until that recipe is made fail-closed, **a reported `make ci` success is not acceptable evidence that E2E passed**. The dedicated `make test-e2e` target is a single Turbo command and does propagate its failure ([Makefile](../../Makefile#L782-L784)).

### Local Turbo cache is useful, but is not proof of completeness

Turbo can filter tasks by package, directory, and source-control changes, including changes relative to `main`; it can also restore deterministic task outputs from local or remote cache.[^turbo-running][^turbo-cache] Use those features to shorten worker feedback.

Do not yet use an affected-only run or a cache hit as the sole merge proof:

- the test task inputs include `src/**`, `test/**`, Vitest config, and `package.json`, but omit the root `pnpm-lock.yaml`, migrations, Dockerfiles, Compose files, and several shared test-infrastructure paths ([turbo.json](../../turbo.json#L68-L130));
- `check-types` names `package-lock.json`, although this repository uses `pnpm-lock.yaml` ([turbo.json](../../turbo.json#L131-L140));
- Docker builds are explicitly uncacheable ([turbo.json](../../turbo.json#L38-L43));
- the workflows cache the pnpm dependency store, but do not configure a shared Turbo cache ([CI workflow](../../.github/workflows/ci.yml#L16-L43), [E2E workflow](../../.github/workflows/e2e.yml#L25-L53)). GitHub distinguishes dependency caching from caching or passing build outputs.[^github-cache]

A cached scoped run is valid local evidence only when the worker records the exact command and Turbo result. GitHub's clean full graph remains the backstop until task inputs and remote-cache policy are corrected and shadow-validated.

### The test surfaces are genuinely different

The repository exposes four useful verification levels:

1. **Static and build:** `build`, `lint`, and `check-types` Turbo tasks.
2. **Unit/component:** package `test:unit` tasks, including Node and jsdom suites. The browser workspace also unit-tests its environment and Playwright configuration without launching a browser ([web E2E package](../../apps/web-e2e/package.json#L6-L14)).
3. **Real-backend integration:** service and core `test:integration` tasks use Testcontainers against PostgreSQL, NATS, MinIO, Redis, and/or OpenSearch. Testcontainers requires access to a supported container runtime; its global-setup guidance explicitly discusses sharing an expensive container while isolating/resetting state.[^testcontainers-runtime][^testcontainers-setup]
4. **E2E/startup:** Testcontainers-based container E2E plus Playwright against the ingress-routed application stack. Playwright supports starting a local web server as part of test configuration, and its CI guidance treats changed-test selection as a heuristic that must be followed by a full suite.[^playwright-webserver][^playwright-ci]

Vitest's `maxConcurrency` only limits tests/hooks declared concurrent; `maxWorkers` limits test workers.[^vitest-concurrency][^vitest-workers] Several service configs set `poolOptions.threads.maxThreads`, but Vitest 3 defaults to forks; these settings therefore do not reliably cap the measured worker fan-out. The gateway and distributed-ingestor configs are explicit serial exceptions. This supports bounding outer Turbo concurrency now and fixing Vitest worker limits separately rather than dropping real-backend tests.

## Sandbox gate: required before creating or updating a PR

The worker must report each command, exit status, cache status where Turbo reports it, and any intentionally unrun surface. A review-only change reruns the same relevant gate after the review edit.

### 1. Always run ticket-scoped static checks

For every changed production or test workspace, run its build (when present), lint, and type-check. Prefer explicit package filters derived from the diff, for example:

```sh
pnpm turbo run build lint check-types --filter=@wallpaperdb/media
```

For shared packages, include known downstream consumers when the API or generated output changed. An SCM-filtered command is a useful cross-check:

```sh
pnpm turbo run build lint check-types --filter='[main...HEAD]'
```

However, explicit package reasoning is required because the current Turbo input graph is incomplete. Documentation-only changes may use the relevant docs build/lint instead of unrelated application checks.

### 2. Always run the tests closest to the change

- Run the changed workspace's `test:unit` when it has one.
- Run specific regression tests during development, then the whole affected unit workspace before PR publication.
- A test-only change must execute the test it changes; compiling it is not enough.

Examples:

```sh
pnpm turbo run test:unit --filter=@wallpaperdb/web
pnpm turbo run test:unit --filter=@wallpaperdb/web-e2e
```

### 3. Escalate to real-backend integration when production semantics require it

Run the affected service's complete `test:integration` task when a change touches an adapter, migration, query, event delivery/acknowledgement, object storage behavior, Redis atomicity/rate limiting, search mapping, dependency readiness, or test-container builder. Run one service at a time:

```sh
pnpm turbo run test:integration --filter=@wallpaperdb/media --concurrency=1
```

Changes to shared contracts, `packages/core`, `packages/events`, test builders, migrations, the lockfile, or infrastructure must include all plausibly affected real-backend suites, not only the package owning the changed file. If impact cannot be bounded confidently, request the exclusive heavy slot and run the broad integration lane rather than guessing.

### 4. Escalate to startup and E2E for user-visible or deployed behavior

The worker must be able to start and exercise the application. Use the worktree-specific Compose identity and ports generated during sandbox setup; never use a shared hard-coded stack. The current sandbox has the host Docker socket, host networking, worktree setup, and a ten-minute bootstrap timeout ([sandbox configuration](../../.sandcastle/sandbox.ts#L7-L46)), so these surfaces are technically available.

Run startup/readiness proof when changing a service entry point, image, environment contract, routing, migration-at-boot behavior, Compose/Caddy wiring, or health/readiness behavior:

```sh
make infra-start
make apps-start
# Verify the ticket-relevant /health and /ready route(s).
make apps-stop
make infra-stop
```

Run the appropriate E2E workspace when changing a cross-service journey, container boundary, browser/auth/upload flow, or the E2E harness:

```sh
make ingestor-e2e-test
# Or, with the application stack already ready:
make web-e2e-test
```

The browser config intentionally uses one worker, serial execution, no local retry, a setup dependency for auth, and retained failure traces/video/screenshots ([Playwright config](../../apps/web-e2e/src/playwright-config.ts#L21-L50)). Its preflight fails before Playwright if the web base URL or any routed service is not ready ([web E2E package](../../apps/web-e2e/package.json#L6-L10)). Therefore it is a meaningful local ticket proof, not merely a CI-only test.

Always tear down in a `finally`-equivalent path and retain failure logs/artifacts. Full Compose/browser E2E and broad Testcontainers runs are exclusive heavy operations and must not overlap another worker's heavy lane.

### 5. Do not require broad local duplication

Do **not** require any of these before every PR update:

- `make ci` or `make ci-force`;
- every service's integration suite for a leaf-only change;
- the full browser suite for backend-local behavior already proved at the relevant real boundary;
- local coverage merge/upload;
- a cold no-cache run.

A worker may run any of them when scope is uncertain or the ticket needs it. A failed relevant check may not be waived merely because GitHub Actions will run later.

## GitHub Actions: authoritative merge checks

Make the following clean-run lanes required branch checks. GitHub branch protection can require named status checks to be successful, skipped, or neutral before merge; configure these lanes as required rather than relying on prose in the worker prompt.[^github-protection]

| Authoritative lane | Required scope | Resource shape |
|---|---|---|
| **Static + unit** | Full `build`, `lint`, `check-types`, and `test:unit` graph on the PR merge commit | Bound Turbo concurrency (start with 2); upload unit coverage |
| **Real-backend integration** | Full `test:integration` graph against real dependencies | Separate lane, Turbo concurrency 1 initially; cap Vitest with `maxWorkers`; retain logs/JUnit |
| **Container E2E** | `@wallpaperdb/testcontainers`, `@wallpaperdb/test-utils`, and `@wallpaperdb/ingestor-e2e`, including the isolation check | Serial; no full Compose application stack resident |
| **Browser/startup E2E** | Build/start infrastructure and applications, readiness preflight, full `@wallpaperdb/web-e2e` Chromium suite | One worker; exclusive Compose stack; always teardown; upload Playwright and service diagnostics on failure |

The repository currently has two broad jobs: `Build, Lint, and Test` and `E2E Tests` ([CI workflow](../../.github/workflows/ci.yml), [E2E workflow](../../.github/workflows/e2e.yml)). They should remain authoritative while the lanes are refactored, with these qualifications:

1. The CI job currently runs unit and integration together without a concurrency bound ([CI workflow](../../.github/workflows/ci.yml#L39-L46)). Stage or split them to avoid reproducing the measured peak.
2. The E2E job starts the full infrastructure and application stacks, then runs **all** `test:e2e` tasks, including independent Testcontainers suites ([E2E workflow](../../.github/workflows/e2e.yml#L40-L74), [Makefile](../../Makefile#L782-L784)). Split container E2E from browser E2E so those stacks do not compound.
3. Both jobs repeat installation and broad builds and only share the pnpm store. Add Turbo remote caching only after the input graph is corrected; cache hits should change cost, never required coverage.
4. Preserve `if: always()` teardown and failure-only browser/service diagnostics from the existing E2E job ([E2E workflow](../../.github/workflows/e2e.yml#L55-L82)).
5. Test the PR merge commit, not merely the worker's pre-rebase head. A merge queue, if adopted, must run the same required checks on the queued commit.

GitHub's full lanes are authoritative even when the worker ran a broader local command, because they prove a clean toolchain, repository-wide graph, CI-only secrets/environment behavior, complete coverage, and the exact merge candidate. Local evidence is still mandatory because it prevents known failures from consuming the expensive queue and gives the agent a short repair loop.

## Prompt policy to implement

Replace “Before committing, run `make ci`” in both worker prompts with the following policy:

> Before creating or updating the PR, inspect the diff and run build/lint/type-check plus the complete unit workspace for every affected package. Run real-backend integration, application startup/readiness, container E2E, and/or browser E2E whenever the ticket changes that surface. Use explicit Turbo package filters and concurrency 1 for container-heavy tasks. Record commands and outcomes in the PR. Do not run `make ci` by default; it is broad, resource-heavy, and currently does not reliably propagate E2E failure. Never skip a relevant test because GitHub Actions will run it later. If impact is uncertain, escalate to the broader lane.

The reviewer should validate the implementer's scope selection, rerun checks affected by review edits, and request an exclusive heavy run where evidence is missing. It should not automatically rerun the same broad pipeline.

## Preconditions and follow-up work

1. **Fix `make ci`/`make ci-force` exit propagation** before using either command as evidence (for example, fail-closed shell mode or explicit status handling).
2. **Split and bound Actions lanes** as shown above; begin with Turbo concurrency 2 for static/unit and 1 for integration/E2E, then tune from measurements.
3. **Cap Vitest workers with `maxWorkers`** for container suites. Do not confuse it with `maxConcurrency`.
4. **Correct Turbo inputs** to include `pnpm-lock.yaml`, migrations, contracts, Dockerfiles/Compose, and shared test infrastructure where relevant.
5. **Add remote Turbo cache** across Actions jobs only after input correctness is proven.
6. **Require named checks in branch protection.** A protection API lookup during this research returned HTTP 404, so this document does not assume that required checks are currently configured.
7. **Keep sandbox capability intact.** Resource admission should queue one broad/full-stack proof, not remove Docker or browser access from tickets that need it.

## Acceptance criteria for the split

The policy is working when:

- a leaf change gets static + complete affected unit feedback locally without a full-repository run;
- a persistence/event/storage change is proved against its real backend locally;
- a browser/startup ticket can start its isolated app stack and run Playwright before PR publication;
- no successful local result can hide an E2E nonzero exit;
- one Actions run covers every full lane on the merge candidate with bounded resource use;
- required Actions checks, rather than an agent-authored statement, determine merge eligibility;
- cache misses affect duration but do not alter which authoritative checks execute.

## Primary sources

[^turbo-running]: Turborepo, [Running tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks) (package/directory/source-control filters and affected tasks).
[^turbo-cache]: Turborepo, [Caching](https://turborepo.dev/docs/crafting-your-repository/caching) (deterministic task hashes, inputs/outputs, local and remote cache).
[^vitest-workers]: Vitest, [`maxWorkers`](https://vitest.dev/config/maxworkers) (maximum test-worker concurrency).
[^vitest-concurrency]: Vitest, [`maxConcurrency`](https://vitest.dev/config/maxconcurrency) (limit for `test.concurrent` and `describe.concurrent`, not worker count).
[^playwright-ci]: Playwright, [Continuous Integration](https://playwright.dev/docs/ci) (CI installation/execution and warning that changed-test selection is heuristic and should be followed by the full suite).
[^playwright-webserver]: Playwright, [Web server](https://playwright.dev/docs/test-webserver) (launching and waiting for a local application server before tests).
[^testcontainers-runtime]: Testcontainers for Node.js, [Supported container runtimes](https://node.testcontainers.org/supported-container-runtimes/) (Docker-compatible runtime configuration).
[^testcontainers-setup]: Testcontainers for Node.js, [Global setup](https://node.testcontainers.org/quickstart/global-setup/) (trade-offs of shared expensive containers, sequential execution, and state management).
[^github-cache]: GitHub Docs, [Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) (dependency-cache behavior and scope).
[^github-protection]: GitHub Docs, [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) (required status checks as merge conditions).
[^lakebed]: Existing Lakebed report source, `/home/rafaeltab/artifacts/wallpaperdb-ci-resource-report/client/index.tsx`, especially lines 47–79, 95–129, 168–178, and 203–230. This is the supplied empirical report artifact; no product changes were made for that investigation.
