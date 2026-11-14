# Testing 

## Scopes

**Capability test:** Tests of the *functional test type* that exercise *capabilities* with the *unit test boundary*, using the *node test runtime*.
Backend or Frontend.

**Driving adapter test:** Tests of the *contract test type* that exercise *driving adapters* with the *unit test boundary*, using the *node test runtime*.
Backend only.
Rafael note: uncertain about calling this the unit test boundary. We might have to add another boundary type for this? We might exercise integration with HTTP or sockets or event systems here?

**Driven adapter test:** Tests of the *contract test type* that exercise *driven adapters* with the *integration test boundary*, using the *node test runtime* for backend and frontend, with frontend sometimes using the *browser test runtime*.
Backend or Frontend.

**Component test:** Tests of the *functional test type* that exercise UI components with the *unit test boundary*, using the *node test runtime* or the *browser test runtime*.
Frontend only.
Rafael note: uncertain about calling this the unit test boundary. We might have to add another boundary type for this? We often excercise integration with real react and real browser here.

**Service test:** Tests of the *functional test type* that exercise a single public interface from a service with the *integration test boundary*, using the *node test runtime*.
Backend only.

**Feature test:** Tests of the *functional test type* that exercise the full application with the *E2E test boundary*, using the *playwright test runtime*.
Entire system only.

**Detail test:** Tests of any *test type* that lock down a specific expectation in a small subject with the *unit test boundary*, using the *node test runtime* or the *browser test runtime*.
Backend or Frontend. 

## Types

**Functional test type:** A type of test that verifies that a subject produces required behavior. Often of the *acceptance test sub-type* as well.

**Contract test type:** A type of test that verifies that a subject adheres to a specified contract, ensuring a correct response and/or action in a scenario.

### Sub-types

**Acceptance test sub-type:** A type of test that verifies that a feature satisfies an agreed requirement.

**Regression test sub-type:** A type of test that prevents unwanted behavior from returning in the future.

## Boundaries

**Unit test boundary:** A test boundary where public dependencies are controlled. Tests using this boundary never rely on infrastructure.

**Integration test boundary:** A test boundary that verifies correct integration with real infrastructure. Minimal dependency control.

**E2E test boundary:** A test boundary that verifies the whole system is working as expected, using real services, infrastructure, using the *playwright test runtime*.

## Runtime

**Browser test runtime:** A test runtime where tests run inside a real browser such as chromium, without having user-like control over the browser.

**Node test runtime:** A test runtime where tests run in the NodeJS runtime, no browser integration at all.

**Playwright test runtime:** A test runtime where tests run inside playwright with a real browser and user-like control over the browser.

