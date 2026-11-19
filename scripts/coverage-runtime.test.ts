import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("coverage runtime preserves source identity, audit, publication and native measurements", () => {
	expect(() =>
		execFileSync(
			process.execPath,
			["--test", "scripts/coverage-runtime/*.test.mjs"],
			{
				cwd: fileURLToPath(new URL("../", import.meta.url)),
				stdio: "pipe",
				env: { ...process.env, NODE_OPTIONS: "" },
			},
		),
	).not.toThrow();
}, 120_000);
