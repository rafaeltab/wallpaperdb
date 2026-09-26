# Ingestor deployment tests

Tests the built Ingestor through public HTTP and event contracts without importing application code. This catches packaging and deployment wiring errors that in-process tests cannot detect.

The suite starts its own infrastructure and application containers. Capability rules and adapter edge cases belong in the owning workspace's tests.
