---
name: create-service
description: Integrate a new service or shared package into the repository. Use when adding a workspace under apps/ or packages/.
---

# Create a workspace

Use the [coding guidelines index](../../../../CODING_STANDARDS.md) for architecture and testing requirements. An existing workspace is a wiring reference, not an architectural standard.

1. Define the workspace's purpose, owning context, and public interface. Keep context-specific policy out of shared packages.
2. Follow an existing workspace's package scripts and configuration. Use `make help` for shared commands and `make run PACKAGE=<workspace> SCRIPT=<script>` for workspace scripts. Do not add per-service aliases. New repository-wide Make targets need `.PHONY` declarations and `##` help descriptions.
3. Run `make run PACKAGE=scripts SCRIPT=lint:workspaces` to verify workspace ownership, task registration, and package dependency direction. For a service, run `make run PACKAGE=scripts SCRIPT=check:services`; review startup dependencies and the resulting startup path.
4. For a service, update environment generation in [setup-worktree.ts](../../../../scripts/setup-worktree.ts). Check `buildServiceOverrides()` and `generateBrunoEnv()` so Docker-internal addresses and worktree URLs are correct. Add new user secret names to `knownUserSecrets` in [env-pipeline.ts](../../../../scripts/lib/env-pipeline.ts). Keep example environment files free of real secrets.
5. Add requests for public routes to the [Bruno collection](../../../../api/) and verify their semantics. The service audit checks health-request and environment-template wiring.
6. Write a short purpose-focused README with $write-readme. Add domain vocabulary and ADRs only when there is a term or decision to record.
7. Run the relevant workspace checks through Make. For environment or deployment changes, verify the generated environment and startup path too.

Shared packages do not need service deployment, environment, or Bruno wiring.
