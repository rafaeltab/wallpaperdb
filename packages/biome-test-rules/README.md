# Test correctness rules

This workspace owns WallpaperDB's shared test correctness policy for Biome. It adds checks for mistakes that can make a test pass without verifying its assertion.

## Capabilities

The assertion rule rejects incomplete matcher chains, including accidental two-argument `expect` calls. A reason as the second argument remains valid when the assertion has a matcher.

The regression tests run the actual Biome CLI with the exported configuration. Keep invalid examples in those tests so ordinary repository linting does not discover them as test sources.

## Maintenance

The CLI and runtime versions are pinned together because Biome's JavaScript plugin API is a developer preview. Check the [upstream plugin documentation](https://biomejs.dev/linter/plugins/) and run the regression suite when upgrading either dependency.

Use the standard workspace tasks through [Make](../../Makefile). Repository ownership and testing requirements are in the [coding guidelines](../../CODING_STANDARDS.md).
