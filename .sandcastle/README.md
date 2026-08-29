# WallpaperDB Sandcastle

This repo is configured to run Sandcastle with Docker sandboxes and OpenCode.

## One-time/local setup

The sandbox uses ignored local files for credentials:

- `.sandcastle/.env` can contain `GH_TOKEN` from `gh auth token`. If this file is missing, `.sandcastle/main.ts` falls back to the local GitHub CLI credential from `gh auth token`.
- `.sandcastle/.opencode/auth.json` is a copy of the host OpenCode OAuth credential.

Refresh them with:

```sh
umask 077
mkdir -p .sandcastle/.opencode
gh auth token | awk '{ print "GH_TOKEN=" $0 }' > .sandcastle/.env
cp ~/.local/share/opencode/auth.json .sandcastle/.opencode/auth.json
chmod 600 .sandcastle/.env .sandcastle/.opencode/auth.json
```

The Docker sandbox talks to the direct host Docker daemon via `DOCKER_HOST=unix:///var/run/docker.sock` and a bind-mounted `/var/run/docker.sock`. The sandbox user is added to the host Docker socket group, so the old LXD TCP Docker API proxy is no longer needed.

The sandbox also bind-mounts the host WallpaperDB config directory:

- host: `~/.config/wallpaperdb`
- sandbox: `/home/agent/.config/wallpaperdb`

`pnpm install` runs `scripts/setup-worktree.mjs`, which reads `~/.config/wallpaperdb/secrets.env` (falling back to the legacy `secret.env` filename) and writes ignored per-app `.env` files before any OpenCode agent starts.

Override the host config path with `WALLPAPERDB_CONFIG_DIR=/path/to/config pnpm sandcastle` if needed.

## Build the image

```sh
pnpm exec sandcastle docker build-image --image-name wallpaperdb-sandcastle:opencode
```

## Run the loop

```sh
pnpm sandcastle
```

By default it runs up to 10 iterations. Override with:

```sh
SANDCASTLE_MAX_ITERATIONS=1 pnpm sandcastle
```

OpenCode defaults to `openai/gpt-5.6` with the `medium` reasoning variant. Override either setting with `SANDCASTLE_OPENCODE_MODEL` or `SANDCASTLE_OPENCODE_VARIANT`.

Sandcastle looks for open GitHub issues labeled `Sandcastle`. Each iteration first runs an OpenCode planning agent, which selects one actionable issue and returns a detailed plan. The runner then creates the deterministic `sandcastle/issue-<number>` branch and starts a separate OpenCode implementation agent with that plan. Only after implementation commits exist does a reviewer agent review, fix, and verify the result on the same branch. The prompts require `make ci` to run inside the Docker sandbox before closing the issue. Only after review completes does the runner push the branch and create a pull request against the repository default branch. All phases and iterations run sequentially.

At the end of every iteration, Sandcastle also cleans Docker resources for that worktree. Cleanup uses the same `COMPOSE_PROJECT_NAME` derived by `scripts/setup-worktree.mjs`, runs `docker compose down --volumes --remove-orphans` for both compose files, then removes any remaining containers, networks, and volumes whose names include that project name.

Disable Docker cleanup with:

```sh
SANDCASTLE_DOCKER_CLEANUP=false pnpm sandcastle
```

Override the pull request base branch with:

```sh
SANDCASTLE_PR_BASE_BRANCH=my-base pnpm sandcastle
```

## Diagnose agent output streaming

Run the reusable-sandbox implementer path without selecting or implementing an issue:

```sh
make sandcastle-stream-smoke
```

The smoke agent only prints a greeting, runs one `printf` command, reads
`.sandcastle/CODING_STANDARDS.md`, and emits a completion marker. It does not edit files, commit,
access GitHub, or start the planner/reviewer phases.

To include every raw OpenCode JSON line in the terminal, use:

```sh
SANDCASTLE_STREAM_VERBOSE=true make sandcastle-stream-smoke
```

Raw mode is intentionally noisy. It distinguishes an agent/transport failure from a Sandcastle
parser or terminal-display failure. Once upstream issue
[mattpocock/sandcastle#966](https://github.com/mattpocock/sandcastle/issues/966) is fixed and this
project upgrades, run the smoke test in normal mode and remove the reusable-sandbox verbose
workaround after parsed agent text and tool calls render correctly.

The normal workflow temporarily uses this noisy raw mode for implementer and reviewer runs so
their progress remains visible. Planner output stays in Sandcastle's readable normal mode.
