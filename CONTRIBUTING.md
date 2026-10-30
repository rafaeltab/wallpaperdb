# Contributing to WallpaperDB

Use the [coding guidelines](CODING_STANDARDS.md) relevant to your change. Run repository tasks through Make; `make help` lists commands and this worktree's ingress address.

## Set up a checkout

Install [mise](https://mise.jdx.dev/getting-started.html) at the minimum version in [mise.toml](mise.toml). The validated host is Linux x86-64 with glibc, Docker Engine access, procfs and `flock`. Host Git, Make, a POSIX shell, CA certificates and download/archive utilities are needed to bootstrap. Docker's daemon, permissions, credential helpers and native build dependencies remain host responsibilities.

```sh
git clone https://github.com/rafaeltab/wallpaperdb.git
cd wallpaperdb
mise trust
make install
make toolchain
```

Make selects managed tools automatically. Use `mise exec -- <command>` for direct CLI work. Each new worktree needs trust and installation. Rerun `make install` after toolchain or secrets changes; it regenerates application `.env` files, overwriting manual edits.

[mise.toml](mise.toml) and [mise.lock](mise.lock) define tool versions and platform support. For upgrades, update the configuration, run `mise lock --platform linux-x64`, then validate installation, effective tools, and affected tasks. Keep pnpm's `packageManager` declaration aligned with mise. Local toolchain overrides are unsupported; application runtime compatibility is defined separately by [package.json](package.json).

JavaScript CLIs and Chromium come from workspace dependencies. Playwright browser installation may need host privileges for shared libraries and fonts. Playwright 1.59.1 rejects Ubuntu 26.04's platform target; use a supported runner. Agent-browser has a separate download: `mise exec -- agent-browser install`.

Managed Docker plugins use a derived configuration under ignored `.mise/`; login, logout and context changes still use the source Docker configuration.

Installation assigns isolated ports and generates `.worktree`, infrastructure and application configuration. Fill Clerk credentials and the browser test user's email/password in `~/.config/wallpaperdb/secrets.env`, or `$XDG_CONFIG_HOME/wallpaperdb/secrets.env`. The legacy `secret.env` name is accepted. Keep credentials outside Git. Environment variables supplied to installation take precedence.

```sh
make infra-start
make dev
```

Open the address printed by `make help`, followed by `/web`. Other routes are in [Caddy's configuration](infra/caddy/Caddyfile). Use generated ports rather than service defaults. `make dev` watches Docker applications; `make dev PACKAGE=<workspace>` runs that workspace's script, which may run on the host and need host-accessible dependency endpoints.

Use `make infra-start-admin` for `/pgadmin/` and `/opensearch-dashboards/`. Ordinary startup and browser E2E omit those optional UIs; LGTM remains enabled for telemetry.

PostgreSQL [initialization](infra/postgres/init/01-init.sql) runs only for empty volumes. An older volume needs the `wallpaperdb_wallpaper` database and grant added with `make psql`; restarting PostgreSQL will not create it. See [service upgrades](apps/docs/content/docs/guides/service-upgrades.mdx) and [storage migration](apps/docs/content/docs/infrastructure/seaweedfs.mdx) before upgrading retained data.

### Asset authority and operator inbox

[Asset setup](apps/asset/scripts/development-authority.ts) generates private `apps/asset/.authority.json`, `infra/nats/.generated.conf`, and `infra/.operator-inbox.json`. They contain credentials and stay outside Git and image build contexts. Setup preserves existing identities and credentials.

Edit the authority file to change permissions, identity providers or the operator destination. Run `make run PACKAGE=asset SCRIPT=dev:configure` to regenerate projections, including on older checkouts before starting the inbox. Broker changes require a controlled restart; replacing active configuration requires explicit `activate` through the [operator CLI](apps/asset/scripts/operator.ts). Initial development startup provisions accounts and initializes empty state after migration.

The inbox at `/operator-inbox/` uses HTTP Basic username `operator` and the authority file's `operatorNotification.token` as password. It displays persisted receipts. Use the operator CLI for recovery: `recover-result --id` takes the notice's `resultId`, not its notification `id`; `recover-source-confirmation --id` takes `sourceConfirmationId`. Deployed installations should configure their trusted webhook and credentials.

## Check a change

```sh
make check PACKAGE=<workspace>
make test-focused PACKAGE=<workspace> ARGS='<test path>'
make ci
```

Select tests using the [testing guidelines](docs/coding-standards/project-organization.md#shared-testing-principles). Focused tests build dependencies and run serially. Local CI includes build, lint, type checks, unit/integration tests and coverage merging; it excludes E2E. Override its default concurrency of four with `CI_CONCURRENCY=1` on smaller hosts.

Integration tests own their containers and need Docker, without application-stack credentials. Web browser adapter tests also need `make run PACKAGE=web SCRIPT=test:browser:install`.

GitHub Actions enforces complete browser and container E2E through the [E2E workflow](.github/workflows/e2e.yml). For deliberate local validation:

```sh
make test-e2e PACKAGE=web-e2e ARGS='specs/upload.spec.ts'
make test-e2e PACKAGE=test-utils ARGS='tests/postgres.test.ts'
make test-e2e
```

`PACKAGE`, runner `ARGS`, and `FORCE=1` are supported; E2E is uncached. Container-only selections need no Compose stack. Browser runs need generated configuration, Clerk credentials, a seeded test user, and `make run PACKAGE=web-e2e SCRIPT=test:browser:install`.

The [local runner](scripts/local-e2e.mjs) builds current-checkout images and starts a fresh, owned Compose project on this worktree's ports. It checks prerequisites and port availability first, waits for [readiness](apps/web-e2e/src/environment-contract.ts), and removes its own containers and volumes afterward. No manual startup is needed. If ports are occupied, use another slot or stop your own development stack. If PostgreSQL initialization files are unreadable, apply only `chmod a+rx infra/postgres/init` and `chmod a+r infra/postgres/init/*.sql`; host bind-mount restrictions need a separate fix.

CI, integration tests and local E2E share a Docker validation queue across worktrees. Inspect it with `make docker-status`; use `make docker-run ARGS='command arguments'` for other Docker-heavy experiments. Do not wrap coordinated targets in another `flock`. Older checkouts without coordination still need an explicit wrapper on the shared lock.

Prefer calling Make directly. Custom nested launchers must forward the file descriptor named by `WALLPAPERDB_DOCKER_LEASE_FD`, not just its environment variables. Lock files must be empty regular files owned by the current user, without links or group/other write access. For timeout and lock-path controls, see the [queue](scripts/lib/docker-queue.mjs); E2E build/readiness deadlines are in the [runner](scripts/local-e2e.mjs).

Failures print their phase, original status, focused rerun command, and private diagnostics path. Inspect retained logs before retrying or manually cleaning the failed project's resources. Successful runs remove their diagnostics after cleanup. Browser traces and authentication state are private; sanitize excerpts before sharing.

For other scripts, use `make run PACKAGE=<workspace> SCRIPT=<script>`. `PACKAGE` selects a workspace, `SERVICE` an application container, and `DB` a database.

## Pull request history

This repository uses rebase merging. Before publishing, check each layer against its actual base:

```sh
make run PACKAGE=scripts SCRIPT=check:pr-history ARGS='<base> <head>'
```

The [checker](scripts/check-pr-history.mjs) rejects merge commits and branches adding no contents to the current base; reverted patches can be reapplied. Preserve published commits during review fixes and add linear commits. Resolve conflicts with a linear rebase. Invoking [babysit-pr](.agents/skills/wallpaperdb/babysit-pr/SKILL.md) authorizes necessary rewrites within scope; otherwise obtain explicit permission before rewriting published history. Prepare and validate the resolution first. Use an explicit expected-head lease after approval, rerun required validation, and assess [review applicability](#review-evidence).

Before reporting completion or merge readiness, verify GitHub's authenticated `mergeable` result for every PR against its current base. Refresh unknown results; conflicts or an unresolved unknown block handoff. Preserve passing validation and reviews when only the base advances independently and the head and base branch are unchanged. No rebase, synthetic integration checkout, or repeated CI/review is required solely for that advance. Stronger guarantees require approval under [task scope](docs/agents/task-scope.md). Verify already-landed contents rather than rewriting them. Native stack readiness still applies to every layer.

The [history workflow](.github/workflows/pr-history.yml) uses the default branch's trusted validator and treats PR trees as Git data. Its serialized reconciler updates advisory `PR history #<number>` statuses for live comparisons; schedules can be delayed. Run the publisher only through that workflow. These statuses are excluded from the CI gate and are not trusted proof: repository writers can reproduce a status context. Before a ready-to-merge handoff, resolve the live base through GitHub's Git reference API and rerun the checker from the trusted default-branch snapshot against current head/base. Other checks and reviews remain required.

### Incremental mutation-testing pilot

Mutation checks are advisory, separate from `make ci`, and have no score threshold. The [workflow](.github/workflows/mutation.yml) runs changed-code analysis on PRs and cumulative baselines nightly. Report incomplete or failed outcomes without waiting or retrying just to make the pilot green.

The [inventory](mutation.inventory.json) lists supported suites and exclusions. Browser, jsdom, deployed-bundle and subprocess mutation activation remain unvalidated. Local runs are exceptional diagnostics, limited to one workspace and at most 300 seconds including setup and shutdown. Build repository baselines in CI.

```sh
make test-mutation PACKAGE=profile-markdown ARGS='--inventory --offline'
make test-mutation PACKAGE=gateway ARGS='--scope all --files src/adapters/redis/usage.ts --budget 60 --offline'
make test-mutation PACKAGE=profile-markdown ARGS='--budget 30 --baseline /tmp/checkpoint.json --offline'
```

`--files` selects exact workspace-relative source paths; `--suite` selects a stage. `--offline` uses local shared state; `--baseline` imports a repository checkpoint. Use the same Node runtime, OS, libc and architecture when sharing checkpoints. Integration stages acquire the shared Docker lock themselves, so do not wrap mutation runs in it.

See the [coordinator](scripts/lib/mutation-coordinator.mjs) and [runner](scripts/mutation.mjs) for scheduling, budgets and checkpoint rules. Results are in `reports/mutation/summary.json` and `checkpoint.json`, with stage reports under each workspace. A partial or representative run does not establish a complete baseline. Discovery completeness, processed counts, kill rate and execution health are separate measures; even fully processed baselines can contain surviving, uncovered or failed mutations. Conflicting outcomes for identical inputs are execution errors requiring diagnosis.

Declare files outside a workspace in its suite's `externalInputs` and relevant environment variables in `environmentKeys` so changes invalidate reuse. Checkpoints hash environment values. Undeclared inputs and external services remain the suite owner's responsibility. Remote imports trust successful same-repository default-branch runs; PR runs use `--offline` without GitHub credentials. Missing or incompatible imports fall back to a cold run.

The runner exits 0 for completion/no change, 2 for incomplete analysis, 1 for execution/publication failure, and 130 for cancellation. Make changes nonzero recipe statuses, so automation must read the summary. Timing fields are wall-clock measurements; interrupted calls make them lower bounds, not estimates of saved runtime.

On Stryker or Vitest upgrades, retain the [compatibility regression](scripts/mutation-runner.test.mjs) and use bounded real-runner checks for native selection, collection failures, static initialization, uncovered code, hangs and stage provenance. Reassess the [Vitest patch](patches/stryker-vitest-10.0.0.patch) before removal. The [instrumenter patch](patches/stryker-instrumenter-10.0.0.patch) avoids sparse numeric coverage counters; verify Web's full eligible instrumentation with the large clear-code GIF fixture, allocation guard and ordinary timeout before replacing it. A narrow pass is insufficient.

## Review evidence

This applies to local, hosted, automated, code and security reviews. Preserve reviews across independent base advances under [PR history](#pull-request-history); assess applicability when reviewed work or the base branch changes.

### Record the reviewed comparison

Keep the ledger in session state or outside the repository. For each review kind or axis, record reviewer identity, task/result URL, outcome, findings, scope, requirements, full head SHA, base repository/ref and SHA, merge-base SHA, and diff command. Preserve Git objects or a patch with base context so the comparison remains reconstructable. Bind hosted reviews using authenticated metadata or a captured starting comparison; unbound results are incomplete evidence.

### Assess applicability after changes

1. Capture current head, live base and merge-base. Compare patch series with `git range-diff <old-merge-base>..<old-head> <new-merge-base>..<new-head>` and inspect aggregate diffs for split, squashed or reordered commits. Retain commands, OIDs, outputs and assessment.
2. Inspect changed patches, conflict resolutions, and relevant base changes, including changes outside PR files. Equal patches do not prove unchanged behavior or assumptions.
3. Carry forward clean reviews only where work and assumptions remain equivalent. Explain inconsequential differences. Material behavior, requirement or security changes need fresh review of affected work and interactions. Preserve unaffected evidence. Missing context or unexplained differences leave applicability incomplete; older clean results cannot bypass unresolved findings or newer pending/adverse reviews.
4. Record the assessor, current comparison, original result and actual reviewed SHA, evidence, rationale, retained scope and fresh review needed. Preserve original provenance through later assessments; an applicability assessment is not a new reviewer approval.

Handoffs must distinguish direct review from carried-forward evidence and identify the original and current comparisons. Link artifacts when available; otherwise include reviewer/result, assessor, scope, inspected evidence and rationale inline. Validation, history, branch protection and landing requirements still apply; keep tested trees separate from review evidence.

## Stop or remove a worktree

`make apps-stop` and `make infra-stop` preserve data. `make infra-reset` deletes infrastructure data after confirmation.

Create another checkout with `git worktree add -b <branch> <path>`, then run `make install` there. Linked-worktree project names and persistent slots follow Git's administrative worktree directory, surviving branch changes and detached HEAD. The main checkout uses `wallpaperdb`, slot 0. See [setup](scripts/setup-worktree.mjs) and [naming](scripts/lib/worktree-project.mjs).

Older worktrees adopt this naming on installation. Stop stacks under their previous project name first; setup does not migrate or delete old containers or volumes.

Before removal, run `make worktree-remove` in the checkout to release its slot and delete non-main containers and volumes. Then run `git worktree remove <path>` elsewhere. Already-removed directories use the stale-slot instructions printed by installation. [Teardown](scripts/teardown-worktree.mjs) uses the saved project name and preserves main-checkout volumes; stale cleanup derives it from the administrative slot-file directory.

## Change the documentation

Setup belongs here, domain terms in [context documents](GLOSSARY-MAP.md), decisions in ADRs, and coding rules under [the guidelines index](CODING_STANDARDS.md). The [documentation site](apps/docs/README.md) holds user guides and operational procedures.
