---
name: create-service
description: Integrate a new service or shared package into the repository. Use when adding a workspace under apps/ or packages/.
---

# Create a workspace

Use the [coding guidelines index](../../../CODING_STANDARDS.md) for architecture and testing requirements. An existing workspace is a wiring reference, not an architectural standard.

1. Define the workspace's purpose, owning context, and public interface. Keep context-specific policy out of shared packages.
2. Follow an existing workspace's package scripts and configuration. Use `make help` for shared commands and `make run PACKAGE=<workspace> SCRIPT=<script>` for workspace scripts. Do not add per-service aliases. New repository-wide Make targets need `.PHONY` declarations and `##` help descriptions.
3. Check that the CI workflows discover the workspace and run its tests. Check deployment configuration, startup dependencies, health checks, and ingress when adding a service.
4. For a service, update environment generation in [setup-worktree.mjs](../../../scripts/setup-worktree.mjs). Check `buildServiceOverrides()` and `generateBrunoEnv()` so Docker-internal addresses and worktree URLs are correct. Add new user secret names to `knownUserSecrets` in [env-pipeline.mjs](../../../scripts/lib/env-pipeline.mjs). Keep example environment files free of real secrets.
5. Add health requests and requests for public routes to the [Bruno collection](../../../api/). Put the base URL in its environment template and check the generated worktree environment.
6. Write a short purpose-focused README with the [README skill](../write-readme/SKILL.md). Add domain vocabulary and ADRs only when there is a term or decision to record. A workspace does not need a second description in the documentation site.
7. Run the relevant workspace checks through Make. For environment or deployment changes, verify the generated environment and startup path too.

Shared packages do not need service deployment, environment, or Bruno wiring.
