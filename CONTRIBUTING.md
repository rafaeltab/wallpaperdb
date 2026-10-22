# Contributing to WallpaperDB

Start with the [coding guidelines](CODING_STANDARDS.md) for the work you are changing. Run repository tasks through Make; `make help` lists commands and prints this worktree's ingress address.

## Set up a checkout

Use Node.js 22.12.0 or later on the 22.x line and the pnpm version pinned in [package.json](package.json). You also need Docker with [Buildx](https://docs.docker.com/build/install-buildx/) and Compose watch support, and Git with worktree support.

```sh
git clone https://github.com/rafaeltab/wallpaperdb.git
cd wallpaperdb
make install
```

Installation assigns an isolated worktree slot and generates `.worktree`, `infra/.env`, and application `.env` files. It also creates `~/.config/wallpaperdb/secrets.env`, or uses `$XDG_CONFIG_HOME/wallpaperdb/secrets.env` when set. The legacy `secret.env` filename is still accepted.

Fill in the Clerk credentials in that secrets file before running authenticated services. Browser tests also need the seeded test user's email and password. Keep those values outside Git. Run `make install` again after changing them. Installation regenerates application `.env` files, so edits made directly to those files will be lost. Environment variables supplied to installation take precedence over the secrets file.

```sh
make infra-start
make dev
```

Open the ingress address printed by `make help`, followed by `/web`. The same ingress exposes `/grafana` and the service routes; see [Caddy's routing configuration](infra/caddy/Caddyfile) for the full list. Port assignments vary by worktree, so use the generated values rather than assuming service default ports.

`make infra-start` and browser E2E omit the optional database and search admin UIs. Run `make infra-start-admin` to include both, then access `/pgadmin/` and `/opensearch-dashboards/` through the application stack's existing Caddy ingress. Infrastructure stop, reset, logs, and worktree teardown include the admin profile. LGTM stays enabled because the applications export telemetry to its collector. Headless runs preserve that behavior while omitting the admin UIs.

`make dev` runs the applications in Docker with source watching. `make dev PACKAGE=<workspace>` runs that workspace's development script; the script determines whether it runs on the host or in Docker. Host-run services need host-accessible dependency endpoints. Use [service upgrade instructions](apps/docs/content/docs/guides/service-upgrades.mdx) and the [storage migration procedure](apps/docs/content/docs/infrastructure/seaweedfs.mdx) when upgrading existing data.

## Check a change

```sh
make check PACKAGE=<workspace>
make test-focused PACKAGE=<workspace> ARGS='<test path>'
make ci
```

Choose tests using the [testing guidelines](docs/coding-standards/project-organization.md#shared-testing-principles). The focused command builds workspace dependencies and runs selected tests serially. Local `make ci` runs build, lint, type checks, unit tests, integration tests, and non-E2E coverage merging. It reports that browser and container E2E are excluded. Integration tests retain their own containers and browser adapter contracts; install their Chromium dependency with `make run PACKAGE=web SCRIPT=test:browser:install` when needed. Ordinary validation needs only the prerequisites of those checks, without application-stack or E2E credentials.

GitHub Actions is the default place for complete browser and container E2E. Both jobs in the [E2E workflow](.github/workflows/e2e.yml) enforce failures on pull requests and main. Use explicit local E2E for diagnosis or deliberate validation:

```sh
make test-e2e PACKAGE=web-e2e ARGS='specs/upload.spec.ts'
make test-e2e PACKAGE=test-utils ARGS='tests/postgres.test.ts'
make test-e2e
```

The [Make command](Makefile) preserves `PACKAGE`, test-runner `ARGS`, and `FORCE=1`. E2E results remain uncached. Container-only selections use their test containers without Compose. Browser selections require generated configuration, development Clerk credentials, a seeded test user, and Chromium. Install Chromium with `make run PACKAGE=web-e2e SCRIPT=test:browser:install`. Run `make install` after updating secrets.

The [local runner](scripts/local-e2e.mjs) checks Docker, configuration, worktree ports, and container access to the public PostgreSQL initialization files before building current-checkout application images. If initialization permissions are rejected, apply only `chmod a+rx infra/postgres/init` and `chmod a+r infra/postgres/init/*.sql`. Docker bind-mount restrictions may need a separate host configuration fix; permission changes alone cannot resolve them.

Browser runs create a unique Compose project with fresh volumes on this worktree's ports. Existing stacks and data remain intact. Occupied ports fail before building; use a free worktree slot or deliberately stop your own development stack. The runner uses non-watching startup, waits for the [browser readiness contract](apps/web-e2e/src/environment-contract.ts), and removes only its own containers, network, and volumes on success, failure, or interruption. A complete run releases the browser stack before container suites start. No manual application startup is needed.

Explicit runs wait visibly on `/tmp/wallpaperdb-perf-validation.lock`, shared across worktrees. Other Docker-heavy validation and experiments must also hold this lock, for example `flock -w 900 /tmp/wallpaperdb-perf-validation.lock make ci`. Keep experiments in an owned environment. The runner's lock wait defaults to 900 seconds, image build to 1200 seconds, and startup/readiness to 240 seconds. Override these deadlines with `E2E_LOCK_TIMEOUT`, `E2E_BUILD_TIMEOUT`, and `E2E_READY_TIMEOUT`, in seconds. Cleanup operations have separate bounded deadlines.

Lock targets must be empty regular files owned by the current user, without symbolic links, hard links, or group/other write access. Unsafe targets are rejected without truncating existing data.

Browser credentials and owned artifact paths are passed only to the browser suite process.

The runner prints the failing phase and original status, reports cleanup failures separately, and retains service logs, command output, and browser failure artifacts in the private temporary directory it prints. Oversized command-output lines are omitted with a marker to keep streamed diagnostics bounded. Captures of configuration or service logs are capped at 1 MiB across stdout and stderr. Exceeding that limit fails the phase, stops its child process, and still attempts owned teardown; incomplete output is discarded. Browser artifacts and authentication state are written directly into that run's diagnostics directory; earlier workspace reports and authentication state remain untouched. It removes the run's temporary diagnostics before reporting success, once all requested tests and cleanup succeed. Use its focused rerun command; inspect retained logs before retrying or manually cleaning a failed owned project. Treat browser reports and traces as private and sanitize excerpts before sharing.

For other scripts use `make run PACKAGE=<workspace> SCRIPT=<script>`. `PACKAGE` selects a workspace, `SERVICE` selects an application container, and `DB` selects a database. Read `make help` instead of maintaining a second command list here.

### Incremental mutation-testing pilot

Mutation testing is opt-in and separate from `make ci`. Use Node 22.22.3 to share checkpoints with the [on-demand CI workflow](.github/workflows/mutation.yml). The initial pilots cover [Profile Markdown's unit suite](packages/profile-markdown/mutation.config.json) and [Gateway's Redis adapter integration suite](apps/gateway/mutation.config.json). The Gateway pilot uses real Redis and in-process adapter calls; it does not establish coverage for Gateway's search, instrumentation, or subprocess suites.

```sh
# Check source files changed from origin/main, with a 15-minute execution budget.
make test-mutation PACKAGE=profile-markdown

# Build or extend a complete baseline, bounded to one hour per invocation.
make test-mutation PACKAGE=profile-markdown ARGS='--scope all --budget 3600'

# Bounded integration pilot. Hold the shared Docker validation lock locally.
flock -w 900 /tmp/wallpaperdb-perf-validation.lock make test-mutation PACKAGE=gateway ARGS='--suite integration --scope all --budget 900'
```

The budget covers Stryker startup, its initial test run, and mutation execution. Dependency installation/build and downloading a CI checkpoint happen before that budget. Shutdown gets up to 15 additional seconds to save a partial checkpoint before workers are killed. A completed run exits successfully regardless of score during the pilot. Budget expiry reports **incomplete** and the runner exits with code 2; test/runner errors fail with code 1. Make maps failed recipes to its own exit status, so automation reads the runner's `summary.json` to distinguish them. A timeout before mutation execution may leave no new checkpoint. GitHub's outer job timeout is a failure and may prevent checkpoint upload.

The CI workflow initially runs only on demand. Budget expiry produces an advisory warning, uploads completed work, and does not block a PR. Actual baseline-test or runner failures fail the workflow. If PR mutation checks become required later, incomplete results must block that required check. The proposed initial PR budget is 15 minutes **per affected workspace**, not a repository-wide cap. No score threshold is enforced yet.

Run the same full-scope command again to resume. Each invocation copies compatible Stryker results into a private run directory. Completed results are saved atomically under the repository's shared Git directory, so a new Git worktree can reuse them after installation. Concurrent worktrees publish separate snapshots; the runner selects a compatible snapshot with the most results, rather than merging independent reports. Independent clones need artifact transfer.

When local state is missing, the runner tries compatible artifacts from recent successful default-branch runs of the mutation workflow using authenticated `gh`. PR artifacts never seed that baseline. Run the workflow on the default branch to build shared CI progress; branch runs can consume it. Artifacts expire after 90 days. Use `--offline` to skip GitHub, or `--baseline /path/to/checkpoint.json` to import a downloaded artifact. Missing/incompatible artifacts start a bounded cold run.

Stryker compares source/test changes and uses per-test coverage to select tests. Source-only changes narrow mutation scope to changed files. Relevant test, helper, dependency, or toolchain changes select the full configured scope. Completed work outside the selected scope does not establish a fresh full baseline. The runner invalidates reuse for toolchain, workspace dependency, fixture, configuration, OS/architecture, exact Node version, and declared environment changes. Workspaces that read environment settings must list those names in `environmentKeys` in their suite configuration; values are hashed. External services and undeclared environment inputs remain the suite owner's responsibility. See [Stryker's incremental limitations](https://stryker-mutator.io/docs/stryker-js/incremental/). A baseline is an optimization, not a substitute for ordinary tests.

Reports live under `<workspace>/reports/mutation/<suite>/`. `summary.json` records completion and reuse; `checkpoint.json` is portable state; completed runs also emit `mutation.html` and `mutation.json`. A budget-exhausted checkpoint contains only available results. Generated artifacts are ignored by Git.

The [shared runner](scripts/mutation.mjs) supports additional workspaces through their `mutation.config.json`. Opt in after checking that tests execute instrumented code in the Vitest process. The pinned [Vitest 5 compatibility patch](patches/stryker-vitest-10.0.0.patch) fixes nested test selection, suite failures, error serialization, and static-module isolation. Its [regression test](scripts/mutation-runner.test.mjs) verifies actual detected mutations. Recheck the patch when upgrading Stryker or Vitest; the original selection bug is tracked in [Stryker issue 6210](https://github.com/stryker-mutator/stryker-js/issues/6210).

## Stop or remove a worktree

`make apps-stop` and `make infra-stop` stop this worktree's containers and preserve its data. `make infra-reset` deletes infrastructure data after confirmation.

For another checkout, run `git worktree add -b <branch> <path>` and `make install` in that directory. Each worktree gets separate ports, containers, and volumes.

Linked-worktree Compose project names come from Git's administrative worktree directory name. For example, `.git` pointing to `.git/worktrees/t3-3e761aad` produces `wallpaperdb-t3-3e761aad`. Branch switches, branch renames, and detached HEAD checkouts keep the same project name and persistent slot when installation reruns. The main checkout uses `wallpaperdb`, slot 0. See [setup](scripts/setup-worktree.mjs) and the [shared naming rule](scripts/lib/worktree-project.mjs) for normalization and the length limit.

Existing linked worktrees adopt this naming rule on their next installation. Stop any running stack under its previous project name before regenerating configuration. Setup does not migrate or delete previous containers or volumes.

Before removing a checkout, run `make worktree-remove` there. It releases the slot and deletes non-main worktree containers and volumes. Then use `git worktree remove <path>` from another checkout. If a directory was already removed, follow the stale-slot cleanup instructions printed by the next installation.

Normal [teardown](scripts/teardown-worktree.mjs) uses the project name saved in `.worktree` and preserves main-checkout volumes. Stale cleanup derives the project name from the administrative directory containing the supplied `worktree-slot` file, so it also works when that directory's HEAD file is missing.

## Change the documentation

Keep human setup here, domain terms in [context documents](GLOSSARY-MAP.md), decisions in ADRs, and coding rules under [the guidelines index](CODING_STANDARDS.md). The [documentation site](apps/docs/README.md) holds user guides and operational procedures. Link to these homes instead of repeating them.
