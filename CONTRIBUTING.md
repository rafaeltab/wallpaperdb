# Contributing to WallpaperDB

Start with the [coding guidelines](CODING_STANDARDS.md) for the work you are changing. Run repository tasks through Make; `make help` lists commands and prints this worktree's ingress address.

## Set up a checkout

Use Node.js 22.12.0 or later on the 22.x line and the pnpm version pinned in [package.json](package.json). You also need Docker with [Buildx](https://docs.docker.com/build/install-buildx/) and Compose watch support, and Git 2.38 or later for the history check's [merge simulation](https://git-scm.com/docs/git-merge-tree/2.38.0.html).

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

`make ci`, `make test-integration`, and explicit local E2E automatically join one Docker validation queue shared across worktrees. `make docker-status` shows its owner and waiting work. Use `make docker-run ARGS='command arguments'` for other Docker-heavy experiments, in an owned environment. Queued work runs in admission order and reports queue wait separately from execution. Remove manual `flock` wrappers around these updated commands, which now acquire their own lock. When validating an older checkout, inspect its Makefile first: commands that predate automatic coordination still need an explicit `flock` wrapper on the shared lock. Older `flock` users still coordinate through the same lock file but have no queue metadata.

The [shared queue](scripts/lib/docker-queue.mjs) requires Linux procfs and `flock`, and identifies processes across PID reuse and reboots. Cancelled or dead waiters release their place; child processes inherit the host lock so terminating a coordinator cannot admit another run while its command still executes. Nested coordinated commands reuse that inherited lock. Lock wait defaults to 900 seconds; `DOCKER_VALIDATION_TIMEOUT` overrides it in seconds. `DOCKER_VALIDATION_LOCK_FILE` selects an isolated queue for testing. Existing `E2E_LOCK_FILE` and `E2E_LOCK_TIMEOUT` remain fallbacks. The E2E runner's image build and startup/readiness deadlines remain controlled by `E2E_BUILD_TIMEOUT` and `E2E_READY_TIMEOUT`; see the [runner](scripts/local-e2e.mjs). Cleanup operations have separate bounded deadlines.

Lock targets must be empty regular files owned by the current user, without symbolic links, hard links, or group/other write access. Unsafe targets are rejected without truncating existing data.

Nested coordinated commands require every intermediate launcher to forward the file descriptor identified by `WALLPAPERDB_DOCKER_LEASE_FD`. Forwarding the environment variables alone is insufficient. Node or pnpm launchers that drop extra descriptors cause nested validation to fail before its workload starts. Prefer running coordinated Make targets directly; custom launchers must preserve the descriptor explicitly.

Browser credentials and owned artifact paths are passed only to the browser suite process.

The runner prints the failing phase and original status, reports cleanup failures separately, and retains service logs, command output, and browser failure artifacts in the private temporary directory it prints. Oversized command-output lines are omitted with a marker to keep streamed diagnostics bounded. Captures of configuration or service logs are capped at 1 MiB across stdout and stderr. Exceeding that limit fails the phase, stops its child process, and still attempts owned teardown; incomplete output is discarded. Browser artifacts and authentication state are written directly into that run's diagnostics directory; earlier workspace reports and authentication state remain untouched. It removes the run's temporary diagnostics before reporting success, once all requested tests and cleanup succeed. Use its focused rerun command; inspect retained logs before retrying or manually cleaning a failed owned project. Treat browser reports and traces as private and sanitize excerpts before sharing.

For other scripts use `make run PACKAGE=<workspace> SCRIPT=<script>`. `PACKAGE` selects a workspace, `SERVICE` selects an application container, and `DB` selects a database. Read `make help` instead of maintaining a second command list here.

## Pull request history

This repository uses rebase merging. Check each PR layer against its actual base with `make run PACKAGE=scripts SCRIPT=check:pr-history ARGS='<base> <head>'` before publishing. The [history check](scripts/check-pr-history.mjs) rejects merge commits in the PR and branches that would add no contents to the current base. A patch reverted on the base can be reapplied. The [PR history workflow](.github/workflows/pr-history.yml) runs the default branch's trusted validator for all PRs, including documentation changes. It fetches comparison commits as Git data and never executes the submitted tree. A base advance alone does not require rewriting an existing PR.

Preserve published commits while making review fixes, and keep additional commits linear. Resolve base conflicts by preparing a linear rebase, rather than merging the base into the PR. Rewriting published history still needs explicit user authorization; prepare and validate the proposed resolution before requesting it. After an authorized rewrite, use an explicit expected-head lease, rerun affected validation, and obtain fresh reviews for the new comparison. A PR with pre-existing merge commits remains incomplete until its history is resolved.

Before reporting a PR ready for the user to merge, read GitHub's authenticated `rebaseable` status for the current head and base, in addition to checks and reviews. `mergeable: true` alone is insufficient. Refresh an unknown result; if it stays unknown or false, report that limitation instead of declaring readiness. When the branch's contents already landed, verify the landing and report that outcome. Native stack readiness remains required for every stacked layer.

## Stop or remove a worktree

`make apps-stop` and `make infra-stop` stop this worktree's containers and preserve its data. `make infra-reset` deletes infrastructure data after confirmation.

For another checkout, run `git worktree add -b <branch> <path>` and `make install` in that directory. Each worktree gets separate ports, containers, and volumes.

Linked-worktree Compose project names come from Git's administrative worktree directory name. For example, `.git` pointing to `.git/worktrees/t3-3e761aad` produces `wallpaperdb-t3-3e761aad`. Branch switches, branch renames, and detached HEAD checkouts keep the same project name and persistent slot when installation reruns. The main checkout uses `wallpaperdb`, slot 0. See [setup](scripts/setup-worktree.mjs) and the [shared naming rule](scripts/lib/worktree-project.mjs) for normalization and the length limit.

Existing linked worktrees adopt this naming rule on their next installation. Stop any running stack under its previous project name before regenerating configuration. Setup does not migrate or delete previous containers or volumes.

Before removing a checkout, run `make worktree-remove` there. It releases the slot and deletes non-main worktree containers and volumes. Then use `git worktree remove <path>` from another checkout. If a directory was already removed, follow the stale-slot cleanup instructions printed by the next installation.

Normal [teardown](scripts/teardown-worktree.mjs) uses the project name saved in `.worktree` and preserves main-checkout volumes. Stale cleanup derives the project name from the administrative directory containing the supplied `worktree-slot` file, so it also works when that directory's HEAD file is missing.

## Change the documentation

Keep human setup here, domain terms in [context documents](GLOSSARY-MAP.md), decisions in ADRs, and coding rules under [the guidelines index](CODING_STANDARDS.md). The [documentation site](apps/docs/README.md) holds user guides and operational procedures. Link to these homes instead of repeating them.
