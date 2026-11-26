import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { copyBuiltArtifacts } from "../src/copy-built.mjs";
import { coverageEnvironment } from "../src/coverage-env.mjs";

test("relocated deployed bundles retain original TypeScript map identity and bytes", async () => {
	const directory = await mkdtemp(join(tmpdir(), "built-coverage-"));
	try {
		const source = join(directory, "original/dist");
		const target = join(directory, "mirror/dist");
		await mkdir(source, { recursive: true });
		const code = "export function untouched() { return 0; }\n";
		const map = {
			version: 3,
			sources: ["../src/entry.ts"],
			sourceRoot: "",
			sourcesContent: [code],
			mappings: "AAAA",
		};
		await writeFile(join(source, "entry.mjs"), code);
		await writeFile(join(source, "entry.mjs.map"), JSON.stringify(map));
		await copyBuiltArtifacts(source, target);
		expect(await readFile(join(target, "entry.mjs"), "utf8")).toBe(code);
		expect(
			JSON.parse(await readFile(join(target, "entry.mjs.map"), "utf8")),
		).toStrictEqual({
			...map,
			sources: [join(directory, "original/src/entry.ts")],
		});
		expect(
			JSON.parse(await readFile(join(source, "entry.mjs.map"), "utf8")),
		).toStrictEqual(map);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("clean executable environments preserve only V8 transport", () => {
	expect(
		coverageEnvironment(
			{},
			{
				NODE_V8_COVERAGE: "/recordings",
				NODE_OPTIONS: "--import=unwanted",
				SECRET: "unwanted",
			},
		),
	).toStrictEqual({ NODE_V8_COVERAGE: "/recordings" });
	expect(coverageEnvironment({ PORT: "1234" }, {})).toStrictEqual({
		PORT: "1234",
	});
});
