# Assertion checks prototype

This opt-in tooling experiment answers [#415](https://github.com/rafaeltab/wallpaperdb/issues/415). It measures which runtime and static checks reject false passes while keeping valid helper, asynchronous, Effect, and concurrent assertions usable. It defines no repository-wide enforcement policy.

## What it evaluates

The executable controls distinguish supported detections, false positives, and known misses. The full experiment also exercises the existing Profiles capability suite and two frontend suites, including their helper and setup code. It classifies reviewed findings and compares three alternating baseline/enforced runtime samples.

Biome uses the repository's pinned release. Targeted ESLint rules cover matcher validation and imported Promise types. Two small prototype rules investigate inline swallowed assertions and obvious matcher tautologies. Conditional warnings are measured separately. The evaluation deliberately preserves failures that these checks cannot detect. Mutation testing belongs to another prototype.

## Run the experiment

Follow the repository [setup guide](../../CONTRIBUTING.md#set-up-a-checkout), then run from the repository root:

```sh
make run PACKAGE=test-assertions-prototype SCRIPT=experiment
```

For controls without the real-suite measurements:

```sh
make run PACKAGE=test-assertions-prototype SCRIPT=experiment ARGS=--controls
```

The full command prepares workspace dependencies through Make. It prints detection counts, timings, classified findings, and the path to a JSON report and raw tool output in an owned temporary directory. Each subprocess has a two-minute deadline; the behavioral controls have one-second test deadlines. It needs no Docker services, credentials, or application startup. Generated fixture/config files are isolated, ignored by Git, and removed after the run.

A successful command means all expected control outcomes matched, including documented misses and false positives. It does not mean every invalid test was detected. Unexpected collection errors, parser errors, missing tests, skipped Biome inputs, tool errors, or detection drift fail the command.

The measured verdict, limitations, and proposed adoption policy live on [the implementation issue](https://github.com/rafaeltab/wallpaperdb/issues/415). The branch preserves the experiment for review; its command is not part of ordinary test or CI tasks.
