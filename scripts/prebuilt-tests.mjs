#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runPrebuiltTests } from "./lib/prebuilt-tests.mjs";
import { aliases, fixtureScripts, built } from "./prebuilt-tests.config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = await runPrebuiltTests({
	root,
	cwd: process.cwd(),
	args: process.argv.slice(2),
	aliases,
	fixtureScripts,
	built,
});
process.exitCode = result.status;
