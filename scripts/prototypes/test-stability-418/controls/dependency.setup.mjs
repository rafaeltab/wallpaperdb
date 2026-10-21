import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
const require = createRequire(
	new URL("../../../../apps/web-e2e/package.json", import.meta.url),
);
const { test } = require("@playwright/test");
test("declared setup dependency", async () => {
	await writeFile(process.env.STABILITY_SETUP, "ready");
});
