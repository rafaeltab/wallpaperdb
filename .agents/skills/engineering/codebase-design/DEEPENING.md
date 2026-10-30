# Deepening

Use the vocabulary and seam discipline in [SKILL.md](SKILL.md) when consolidating shallow modules.

## Dependency categories

Classify each dependency to select the test approach.

### 1. In-process

Pure computation or memory state without I/O. Merge modules and test directly through the new interface; no adapter is needed.

### 2. Local-substitutable

Use a local stand-in, such as PGLite or an in-memory filesystem, in the test suite. Deepen when that stand-in exists. Keep this seam internal rather than adding a port to the external interface.

### 3. Remote but owned (Ports & Adapters)

For owned services across a network, define a port at the seam. Keep logic in the deep module and inject a transport adapter. Test with an in-memory adapter; production uses HTTP, gRPC, or a queue.

### 4. True external (Mock)

For third-party services, inject the external dependency through a port and supply a mock adapter in tests.

## Seam discipline

Require at least two justified adapters before introducing a port, usually production and test. Keep internal test seams private to the implementation.

## Testing strategy: replace, don't layer

Replace old shallow-module unit tests once tests through the deepened interface exist. Assert observable outcomes rather than internal state, so internal refactoring does not require test changes.
