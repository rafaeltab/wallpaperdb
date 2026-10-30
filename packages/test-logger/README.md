# Test logger

A shared Pino logger factory keeps test output silent until a test author enables diagnostics.

## Core capabilities

- Names loggers so failures can be associated with their test context.
- Defaults to silent output and accepts an environment override for debugging.

See the [factory](src/index.ts) for its interface and configuration.
