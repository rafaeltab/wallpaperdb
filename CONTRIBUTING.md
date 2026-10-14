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

`make dev` runs the applications in Docker with source watching. `make dev PACKAGE=<workspace>` runs that workspace's development script; the script determines whether it runs on the host or in Docker. Host-run services need host-accessible dependency endpoints. Use [service upgrade instructions](apps/docs/content/docs/guides/service-upgrades.mdx) and the [storage migration procedure](apps/docs/content/docs/infrastructure/seaweedfs.mdx) when upgrading existing data.

## Check a change

```sh
make check PACKAGE=<workspace>
make test-focused PACKAGE=<workspace> ARGS='<test path>'
make ci
```

Choose tests using the [testing guidelines](docs/coding-standards/project-organization.md#shared-testing-principles). The focused command builds workspace dependencies and runs selected tests serially. `make ci` is the full repository check. Unit tests generally run without Docker; integration and service deployment tests start their own containers.

The browser E2E suite is different: it expects the ingress-routed application stack and a seeded Clerk test account. Start the stack before `make test-e2e PACKAGE=web-e2e`.

For other scripts use `make run PACKAGE=<workspace> SCRIPT=<script>`. `PACKAGE` selects a workspace, `SERVICE` selects an application container, and `DB` selects a database. Read `make help` instead of maintaining a second command list here.

### Mutation-testing proof of concept

The opt-in Stryker POC checks whether the existing Profile Markdown tests detect deliberate changes to the shared policy. Run it with Node.js 22.18+ on the 22.x line, 24.11+ on the 24.x line, or 26+. Stryker 10's Babel dependencies require this newer runtime.

```sh
make test-mutation PACKAGE=profile-markdown
```

Open `packages/profile-markdown/reports/mutation/mutation.html` to inspect each mutation and its outcome. The same directory contains the JSON report. See the [Stryker configuration](packages/profile-markdown/stryker.config.json) for scope and reporter settings. Generated reports and sandboxes are ignored by Git.

The POC uses Stryker's command runner because its Vitest plugin currently [selects zero tests for covered mutants on Vitest 5](https://github.com/stryker-mutator/stryker-js/issues/6210). Each mutation runs the complete workspace test suite, so this approach costs more than per-test selection and does not distinguish uncovered mutations. No TypeScript checker filters mutations before execution. Review survivors for missing assertions or equivalent behavior before setting a score threshold.

Mutation testing runs separately from `make ci`, bypasses Turbo caching, and has no failing score threshold. Ordinary test failures in the initial run still fail the command. To narrow an investigation, pass a source range relative to the workspace, for example `ARGS='--mutate src/index.ts:59-61'`.

## Stop or remove a worktree

`make apps-stop` and `make infra-stop` stop this worktree's containers and preserve its data. `make infra-reset` deletes infrastructure data after confirmation.

For another checkout, run `git worktree add -b <branch> <path>` and `make install` in that directory. Each worktree gets separate ports, containers, and volumes.

Linked-worktree Compose project names come from Git's administrative worktree directory name. For example, `.git` pointing to `.git/worktrees/t3-3e761aad` produces `wallpaperdb-t3-3e761aad`. Branch switches, branch renames, and detached HEAD checkouts keep the same project name and persistent slot when installation reruns. The main checkout uses `wallpaperdb`, slot 0. See [setup](scripts/setup-worktree.mjs) and the [shared naming rule](scripts/lib/worktree-project.mjs) for normalization and the length limit.

Existing linked worktrees adopt this naming rule on their next installation. Stop any running stack under its previous project name before regenerating configuration. Setup does not migrate or delete previous containers or volumes.

Before removing a checkout, run `make worktree-remove` there. It releases the slot and deletes non-main worktree containers and volumes. Then use `git worktree remove <path>` from another checkout. If a directory was already removed, follow the stale-slot cleanup instructions printed by the next installation.

Normal [teardown](scripts/teardown-worktree.mjs) uses the project name saved in `.worktree` and preserves main-checkout volumes. Stale cleanup derives the project name from the administrative directory containing the supplied `worktree-slot` file, so it also works when that directory's HEAD file is missing.

## Change the documentation

Keep human setup here, domain terms in [context documents](GLOSSARY-MAP.md), decisions in ADRs, and coding rules under [the guidelines index](CODING_STANDARDS.md). The [documentation site](apps/docs/README.md) holds user guides and operational procedures. Link to these homes instead of repeating them.
