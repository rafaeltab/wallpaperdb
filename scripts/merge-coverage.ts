import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
execFileSync(
	process.execPath,
	[fileURLToPath(new URL("./coverage-runtime/inventory.mjs", import.meta.url))],
	{ cwd: root, stdio: "inherit" },
);
const { tiers } = JSON.parse(
	await readFile(
		new URL("../.coverage-runtime/evidence/matrix.json", import.meta.url),
		"utf8",
	),
);
const { mergeReceipts } = await import("./coverage-runtime/receipts.mjs");
await mergeReceipts(
	root,
	tiers.filter((row: { script: string }) =>
		["test:unit", "test:integration"].includes(row.script),
	),
);
