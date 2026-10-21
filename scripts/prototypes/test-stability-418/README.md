# Test stability prototype for #418

Opt-in experiment for [#418](https://github.com/rafaeltab/wallpaperdb/issues/418).
These controls deliberately contain defects. Their filenames keep them outside
normal test discovery. No production runner configuration or CI policy changes.

Use Linux, the repository's installed dependencies, and GNU `/usr/bin/time`.
From the repository root, prepare the sampled workspaces and run:

```sh
make test-focused PACKAGE=user ARGS='--config vitest.unit.config.ts test/profile-capability.unit.test.ts'
make test-focused PACKAGE=web ARGS='test/components/profile/profile-filter.dom.test.tsx'
make run PACKAGE=scripts SCRIPT=prototype:stability:test
make run PACKAGE=scripts SCRIPT=prototype:stability
```

The last command runs 34 invocations, each with a 90-second process-group deadline.
At most two suites run at once. It uses no Docker containers, service credentials,
application stack, or browser binary. Playwright exercises its runner and declared
setup dependency without a `page` fixture. This does not validate browser journeys.
The selected repository suites retain their own setup and run with one worker,
no concurrent test cases, and diagnostic retry failure enforcement.

Every invocation executes the installed runner directly with a fresh report path.
Turbo may cache dependency builds, but cannot return cached test results here.
Each run prints its private temporary directory, with `summary.json`, `results.json`,
`delay-candidates.json`, and per-job logs, JSON reports, retry diagnostics, exact
commands, selected environment, seeds, worker settings, CPU time, and maximum RSS.
GNU time reports the maximum individual process RSS, not the sum of concurrently
resident processes. Paths in artifacts refer to the checkout used for that run.
Keep diagnostics until review; remove only that run's printed directory afterward.

Replay a recorded order or narrow the experiment:

```sh
make run PACKAGE=scripts SCRIPT=prototype:stability ARGS='--job=control-shuffle-418'
make run PACKAGE=scripts SCRIPT=prototype:stability ARGS='--job=control-shuffle-20261021'
make run PACKAGE=scripts SCRIPT=prototype:stability ARGS='--job=playwright-retry-strict'
make run PACKAGE=scripts SCRIPT=prototype:stability ARGS='--only=samples'
make run PACKAGE=scripts SCRIPT=prototype:stability ARGS='--only=controls'
```

An expected negative control retains its raw failing status in its report while
the experiment succeeds if the control behaved as specified. Seed `20261021`
misses the order faults; seeds `418` and `200` expose them with these fixtures and
Vitest 5.0.2. Seeds are runner-version dependent. Missing reports, no executed
tests, timeouts, and suite-load errors require review instead of counting as
successful fault detection. Inspect the original errors to distinguish runner,
infrastructure, and test failures; the automatic classification is preliminary.

The AST scan recognizes direct `sleep`, `setTimeout`, and `waitForTimeout` calls.
It reports review candidates, not proof of misuse. Explicit purpose comments can
exempt timing contracts, deadline guards, and fake responses in these controls.
Aliases, indirect helpers, and dishonest exemptions are outside this experiment.
Use controlled time for timing boundaries; use bounded observable waits for
completion. Immediate negative assertions do not establish sustained absence.

Results and the adoption recommendation belong on #418. This prototype does not
set repository-wide repetition, parallelism, retry, or quarantine policy.
