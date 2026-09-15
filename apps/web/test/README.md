# Auth form test feedback loop

Run only the sign-in and sign-up component tests:

```sh
make web-auth-test
make web-auth-test AUTH_TEST_ARGS='-t "does not call finalize"'
```

Repeat both suites in fresh Vitest processes with V8 coverage, as used by CI:

```sh
make web-auth-test-stress                  # 20 consecutive runs; stop on the first failure
make web-auth-test-stress AUTH_TEST_RUNS=3 # shorter diagnostic run
```

The stress target builds only the shared Vitest configuration and runs exactly
these two suites with two workers. It does not use cached test results or retry
failures. Coverage output goes to `apps/web/coverage/auth-stress/` and is replaced
on each run, leaving the normal web coverage report alone.

On Linux, constrain the workers to one allowed CPU to introduce scheduling
contention without starting unrelated suites or background load generators:

```sh
taskset -pc $$ # inspect the CPUs available to this shell
taskset -c 0 make web-auth-test-stress # replace 0 with an allowed CPU
```

This combines coverage overhead and competing workers in a bounded local check.
GitHub CI remains the check for the full repository's concurrency and coverage
workload. Neither command changes Vitest's 10-second test timeout.

## Keeping interactions deterministic

- Populate credentials with `fireEvent.change`. Per-character `userEvent.type`
  schedules a timer for each character, multiplying scheduler delays under load.
  Keep `userEvent.click` for submission so the test still exercises the button
  and native form validation.
- Assert hook-provided global and field errors directly. These messages are
  already present when the component renders; submitting adds unrelated async
  work. Separate submission tests verify credential payloads, successful
  finalization, and the failed-password path.
- Wait for positive async outcomes with `waitFor` or `findBy`. Before asserting
  that finalization did not happen, settle the mocked response inside async
  `act` so React effects have also run.
- Model Clerk updates with explicit hook values and `rerender`, never the number
  of times React has rendered. Reset mock implementations between tests.
