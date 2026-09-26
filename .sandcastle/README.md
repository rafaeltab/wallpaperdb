# Sandcastle

Runs issue implementation and review agents in Docker sandboxes. Agent execution rules live in [WORKFLOW.md](WORKFLOW.md); coding requirements live in [CODING_STANDARDS.md](../CODING_STANDARDS.md).

## Local setup

Sign in to GitHub with `gh auth login` and to OpenCode, then refresh the ignored sandbox credentials:

```sh
make sandcastle-auth
```

This copies the host OpenCode credential and GitHub token into `.sandcastle/`. If the local token file is absent, the runner can use the GitHub CLI credential. Keep these files out of Git.

The sandbox mounts the host Docker socket and the WallpaperDB config directory. Repository installation reads the mounted `secrets.env`, falling back to the legacy `secret.env`, and generates application environments before agents start. See [contributor setup](../CONTRIBUTING.md) for those credentials. Set `WALLPAPERDB_CONFIG_DIR` when the host config lives elsewhere.

## Run

Build the sandbox image, then start the loop:

```sh
pnpm exec sandcastle docker build-image --image-name wallpaperdb-sandcastle:opencode
pnpm sandcastle
```

Only label issues `ready-for-agent` when they are suitable for unattended implementation. The runner plans issues, creates deterministic issue branches, runs implementation and review, and opens pull requests. Its [phase prompts](plan-prompt.md) and [workflow](WORKFLOW.md) are executable instructions, not background documentation.

Each iteration removes its worktree's Docker containers, networks, and volumes. Use `SANDCASTLE_DOCKER_CLEANUP=false` when you need to retain them for diagnosis. Set `SANDCASTLE_MAX_ITERATIONS=1` for a single iteration and `SANDCASTLE_PR_BASE_BRANCH` to target a different base branch.

Model and reasoning overrides are `SANDCASTLE_OPENCODE_MODEL` and `SANDCASTLE_OPENCODE_VARIANT`. Read [the runner configuration](config.ts) for defaults instead of duplicating them here.
