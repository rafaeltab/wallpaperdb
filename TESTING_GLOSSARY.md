# Testing

This glossary defines the repository's testing vocabulary. Each scope specifies its required test type, boundary, and runtime; these combinations are constraints, not typical examples.

## Scopes

**Capability test:** Tests of the *functional test type* that exercise *capabilities* with the *unit test boundary*, using the *node test runtime*.
Capabilities use *controlled driven adapters* and have no real browser or infrastructure dependencies. Tests call the capability's driving port directly.
Backend or Frontend.

**Driving adapter test:** Tests of the *contract test type* that exercise *driving adapters* using the *node test runtime*, at either the *unit test boundary* or the *integration test boundary*. Prefer the unit boundary for input and outcome translation; use the integration boundary when verifying the contract requires real transport or infrastructure behavior.
Backend only.

**Driven adapter test:** Tests of the *contract test type* that exercise *driven adapters* with the *integration test boundary*, using the *node test runtime* for backend and frontend, with frontend sometimes using the *browser test runtime*.
Backend or Frontend.

**Component test:** Tests of the *functional test type* that exercise UI components with the *unit test boundary*, using the *node test runtime* or the *browser test runtime*.
Frontend only.
Rafael note: uncertain about calling this the unit test boundary. We might have to add another boundary type for this? We often excercise integration with real react and real browser here.

**Service composition test:** Tests of the *functional test type* that verify a service's composition and wiring through a public interface, using real production adapters with the *integration test boundary* and the *node test runtime*. They exercise a representative path rather than repeating the capability's full behavioral matrix.
Backend only.

**UI composition test:** Tests of the *functional test type* that verify the assembled frontend's composition and wiring through its UI, using production frontend adapters with mocked backend services, at the *integration test boundary*, using the *node test runtime* or the *browser test runtime*. They exercise representative paths rather than repeating the full behavioral matrix.
Frontend only.

**Journey test:** Tests of the *functional test type* that exercise a complete user journey through the web UI and real application services with the *E2E test boundary*, using the *node test runtime* and the *Playwright test runner* to control a real browser.
Entire system only.

**Detail test:** Focused tests of a small subject's public interface with the *unit test boundary*, using the *node test runtime* or the *browser test runtime*, and any applicable *test type*. They cover complex calculations or decision tables when this improves diagnosis or provides substantial coverage beyond the other scopes, without asserting private implementation details.
Backend or Frontend.

## Types

**Functional test type:** A type of test that verifies that a subject produces required behavior.

**Contract test type:** A type of test that verifies that a subject adheres to a specified contract, ensuring a correct response and/or action in a scenario.

## Test subjects and dependencies

**Test subject:** The public interface and behavior being verified by a test; its scope determines which implementation participates and which dependencies are controlled.

**Controlled driven adapter:** A test implementation of a capability's driven port whose state and outcomes the test controls. It preserves the port guarantees relied on by capability tests and is verified against shared contract cases where applicable.

**Contract:** The structural and behavioral guarantees at an interface, including inputs, outcomes, failures, and observable effects. A contract may be expressed through schemas, TypeScript interfaces, prose, or a combination; a schema or type alone need not express all of its behavioral guarantees.

## Purposes

Purposes can apply across test types and scopes. A test can have more than one purpose.

**Acceptance test purpose:** Verifies that the subject satisfies an agreed acceptance criterion.

**Regression test purpose:** Detects unwanted changes to established behavior, including the return of a previously fixed defect.

## Techniques

Techniques describe how test cases are constructed and can apply across scopes, types, and boundaries.

**Example-based testing:** Testing with explicitly selected inputs, actions, and expected outcomes.

**Property-based testing:** Testing a stated property across generated inputs or action sequences. A property is a rule expected to hold for every case within the declared input domain.

**Fuzz testing:** Testing with generated or mutated inputs to find failures such as crashes, hangs, resource exhaustion, or violated behavioral guarantees. It overlaps with property-based testing and may use structured inputs or execution feedback rather than only random bytes.

**Shrinking:** Reducing a failing generated case to a simpler case that still reproduces the failure.

**Reproducer:** The inputs and actions needed to demonstrate a failure; generated failures must retain enough information to replay the case.

## Mutation testing

**Mutation testing:** Assessing existing tests by introducing deliberate changes to production code and checking whether those tests detect them. It evaluates tests across scopes rather than defining another application test scope.

**Mutation operator:** A rule that produces a code change, such as replacing `>` with `>=`. Reports also call this a mutator.

**Mutant:** A version of the code containing a generated change whose effect is evaluated against the selected tests.

**Killed mutant:** A mutant for which at least one selected test fails while the mutant is active.

**Surviving mutant:** A mutant for which the selected tests pass despite executing the changed code. Survival requires investigation; it can indicate a missing assertion, an equivalent mutant, or behavior outside the specified guarantees.

**Uncovered mutant:** A mutant whose changed code is not executed by the selected tests, reported as `NoCoverage`.

**Equivalent mutant:** A mutant that preserves observable behavior within the supported contract and therefore cannot be distinguished by a valid behavioral test.

**Mutation timeout:** An evaluation that exceeds its execution deadline, reported as `Timeout`. It is distinct from an explicit test failure.

**Invalid mutation evaluation:** An evaluation that cannot produce usable behavioral evidence because of a compilation or execution error, reported as `CompileError` or `RuntimeError`.

**Pending mutant:** A generated mutant without a completed evaluation, reported as `Pending`; it is neither killed nor surviving.

**Mutation score:** The percentage of mutants counted as killed under the report's aggregation rules. Repository aggregation counts explicit kills in the numerator; timeouts and errors do not increase the score. The authoritative calculation is in [resultCounts](scripts/lib/mutation-results.ts).

**Mutation checkpoint:** Saved mutation results and their input identity that can be reused when compatible with the current evaluation. A saved checkpoint does not imply a complete evaluation.

**Mutation evaluation scope:** The source files, mutation operators, and test suites selected for an evaluation. Completion of a selected scope does not establish completion of the full eligible baseline; the [coordinator](scripts/lib/mutation-coordinator.ts) reports these separately.

## Boundaries

**Unit test boundary:** A test boundary where public dependencies are controlled. Tests using this boundary never rely on infrastructure.

**Integration test boundary:** A test boundary that verifies an integration using the real infrastructure and production adapters involved in that integration. Dependencies outside the integration being verified may be controlled to isolate its behavior.

**E2E test boundary:** A test boundary that verifies a complete workflow through the assembled system, using real application services and infrastructure. The boundary does not prescribe a test runner or require a browser.

## Runtime

**Browser test runtime:** A test runtime where test code executes inside a real browser such as Chromium, with access to real browser APIs. Tests can use user-like browser interactions through the runner's supported automation APIs.

**Node test runtime:** A test runtime where test code executes in Node.js. Tests may use a simulated DOM or control a separate real browser through browser automation; neither moves the test code itself into the browser runtime.

## Runners

**Test runner:** The tool that discovers, executes, and reports tests; it is distinct from the runtime in which test code executes.

**Vitest test runner:** A test runner that supports the *node test runtime* and the *browser test runtime*, including simulated DOM environments in Node and real-browser interactions in Browser Mode.

**Playwright test runner:** A test runner that executes test code in the *node test runtime* and can control separate real browsers through browser automation.
