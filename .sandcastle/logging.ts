export const plannerLogging = { type: "stdout" } as const;

// Temporary workaround for https://github.com/mattpocock/sandcastle/issues/966.
// Remove `verbose` after upgrading to a fixed Sandcastle release and confirming
// that reusable sandboxes render parsed events in normal mode.
export const reusableSandboxLogging = { type: "stdout", verbose: true } as const;
