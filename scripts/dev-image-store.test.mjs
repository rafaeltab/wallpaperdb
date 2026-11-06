import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repository = path.resolve(import.meta.dirname, "..");
const applications = [
	"asset",
	"color-extractor",
	"gateway",
	"ingestor",
	"tags",
	"user",
	"variant-generator",
	"wallpaper",
	"web",
];

for (const application of applications) {
	test(`${application} keeps the build store outside its full dependency layer`, () => {
		const source = fs.readFileSync(
			path.join(repository, "apps", application, "Dockerfile.dev"),
			"utf8",
		);
		assert.match(source, /^ENV PNPM_HOME="\/pnpm"$/m);
		const installations = source
			.replace(/\\\r?\n\s*/g, " ")
			.split("\n")
			.filter((line) => /^RUN .*pnpm install\b/.test(line));
		assert.equal(installations.length, 1);
		const [instruction, mount, ...command] = installations[0].split(/\s+/);
		assert.equal(instruction, "RUN");
		assert.ok(mount.startsWith("--mount="), "Missing build-only store mount");
		assert.deepEqual(
			Object.fromEntries(
				mount
					.slice(8)
					.split(",")
					.map((option) => option.split("=")),
			),
			{
				type: "cache",
				id: "wallpaperdb-pnpm-v10",
				target: "/pnpm/store",
				sharing: "locked",
			},
		);
		assert.equal(
			command.join(" "),
			"pnpm install --frozen-lockfile && sha256sum pnpm-lock.yaml | cut -d' ' -f1 > .pnpm-lockfile-hash",
		);
	});
}
