export interface Diagnostic {
	category: string;
	message: string;
	location?: { path?: string };
	[key: string]: unknown;
}

import { expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const workspace = fileURLToPath(new URL("../", import.meta.url));
const biome = join(
	dirname(require.resolve("@biomejs/biome/package.json")),
	"bin/biome",
);

export function lint(sources: readonly string[]): Diagnostic[][];
export function lint(
	source: string,
	files?: Record<string, string>,
	filename?: string,
	reporter?: "json",
): Diagnostic[];
export function lint(
	source: string,
	files: Record<string, string>,
	filename: string,
	reporter: "terminal",
): string;
export function lint(
	source: string | readonly string[],
	files: Record<string, string> = {},
	filename = "example.test.ts",
	reporter = "json",
) {
	const directory = mkdtempSync(join(tmpdir(), "biome-test-rules-"));
	try {
		const config = JSON.parse(
			readFileSync(join(workspace, "test-correctness.json"), "utf8"),
		);
		config.linter = { rules: { preset: "none" } };
		config.plugins = config.plugins.map((plugin: { path: string }) => ({
			...plugin,
			path: join(workspace, plugin.path),
		}));
		writeFileSync(join(directory, "biome.json"), JSON.stringify(config));
		symlinkSync(
			join(workspace, "node_modules"),
			join(directory, "node_modules"),
		);
		const sources = typeof source === "string" ? [source] : source;
		expect(sources.length).toBeGreaterThan(0);
		const filenames = sources.map((_, index) =>
			typeof source === "string" ? filename : join(`case-${index}`, filename),
		);
		for (const [index, name] of filenames.entries()) {
			mkdirSync(dirname(join(directory, name)), { recursive: true });
			writeFileSync(join(directory, name), sources[index]);
		}
		for (const [path, content] of Object.entries(files))
			writeFileSync(join(directory, path), content);
		const result = spawnSync(
			process.execPath,
			[
				biome,
				"lint",
				...(reporter === "json" ? ["--reporter=json"] : []),
				...(typeof source === "string" ? [] : ["--max-diagnostics=none"]),
				...filenames,
			],
			{
				cwd: directory,
				encoding: "utf8",
				timeout: 30_000,
				maxBuffer: 16 * 1024 * 1024,
			},
		);
		expect(result.error).toBe(undefined);
		expect(
			result.status === 0 || result.status === 1,
			result.stderr,
		).toBeTruthy();
		if (reporter !== "json") return result.stdout + result.stderr;
		expect(result.stdout, result.stderr).toBeTruthy();
		const report: {
			diagnostics: Diagnostic[];
			summary: {
				changed: number;
				unchanged: number;
				skipped: number;
				diagnosticsNotPrinted: number;
			};
		} = JSON.parse(result.stdout);
		expect(
			!report.diagnostics.some((d) => /Rule .* errored:/.test(d.message)),
			JSON.stringify(report.diagnostics),
		).toBeTruthy();
		if (typeof source === "string") return report.diagnostics;
		expect(report.summary.changed + report.summary.unchanged).toBe(
			sources.length,
		);
		expect(report.summary.skipped).toBe(0);
		expect(report.summary.diagnosticsNotPrinted).toBe(0);
		const grouped = new Map<string, Diagnostic[]>(
			filenames.map((name) => [name, []]),
		);
		for (const diagnostic of report.diagnostics) {
			const group = grouped.get(diagnostic.location?.path ?? "");
			if (!group)
				throw new Error(`Unmapped diagnostic: ${JSON.stringify(diagnostic)}`);
			group.push(diagnostic);
		}
		return filenames.map((name) => grouped.get(name) ?? []);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
