import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
	applyOverrides,
	extractKeys,
	filterApplicableSecrets,
	parseEnvValues,
} from "./env-pipeline.ts";

const templatePaths = [
	"infra/.env.example",
	"apps/ingestor/.env.example",
	"apps/asset/.env.example",
	"apps/user/.env.example",
	"apps/color-extractor/.env.example",
	"apps/variant-generator/.env.example",
];

for (const path of templatePaths) {
	test(`${path} preserves custom S3 credentials during environment generation`, () => {
		const template = readFileSync(
			new URL(`../../${path}`, import.meta.url),
			"utf8",
		);
		const credentials = Object.freeze({
			S3_ACCESS_KEY_ID: "custom-storage-user",
			S3_SECRET_ACCESS_KEY: "custom-storage-secret",
		});
		const applicable = filterApplicableSecrets(
			credentials,
			extractKeys(template),
			path,
			() => {},
		);
		const generated = parseEnvValues(applyOverrides(template, applicable, {}));

		expect(generated.S3_ACCESS_KEY_ID).toBe(credentials.S3_ACCESS_KEY_ID);
		expect(generated.S3_SECRET_ACCESS_KEY).toBe(
			credentials.S3_SECRET_ACCESS_KEY,
		);
	});
}

test("storage host port overrides the worktree slot without leaking unrelated secrets", () => {
	const template = readFileSync(
		new URL("../../infra/.env.example", import.meta.url),
		"utf8",
	);
	const secrets = {
		S3_API_HOST_PORT: "8122",
		UNRELATED_API_SECRET: "private-value",
	};
	const worktreeContent = applyOverrides(
		template,
		{ S3_API_HOST_PORT: "8012" },
		{},
	);
	const applicable = filterApplicableSecrets(
		secrets,
		extractKeys(template),
		"infra",
		() => {},
	);
	const generated = parseEnvValues(
		applyOverrides(worktreeContent, applicable, {}),
	);

	expect(generated.S3_API_HOST_PORT).toBe("8122");
	expect(generated.UNRELATED_API_SECRET).toBe(undefined);
});

test("empty storage secrets preserve development credentials from the template", () => {
	const template = readFileSync(
		new URL("../../infra/.env.example", import.meta.url),
		"utf8",
	);
	const applicable = filterApplicableSecrets(
		{ S3_ACCESS_KEY_ID: "", S3_SECRET_ACCESS_KEY: "" },
		extractKeys(template),
		"infra",
		() => {},
	);
	const generated = parseEnvValues(applyOverrides(template, applicable, {}));

	expect(generated.S3_ACCESS_KEY_ID).toBe("storageadmin");
	expect(generated.S3_SECRET_ACCESS_KEY).toBe("storageadmin");
});

test("ingestor environment generation preserves a custom S3 cleanup interval", () => {
	const template = readFileSync(
		new URL("../../apps/ingestor/.env.example", import.meta.url),
		"utf8",
	);
	const applicable = filterApplicableSecrets(
		{ S3_CLEANUP_INTERVAL_MS: "60000" },
		extractKeys(template),
		"apps/ingestor",
		() => {},
	);
	const generated = parseEnvValues(applyOverrides(template, applicable, {}));

	expect(generated.S3_CLEANUP_INTERVAL_MS).toBe("60000");
});

test("User picture storage and infrastructure share default S3 credentials", () => {
	const infrastructure = parseEnvValues(
		readFileSync(new URL("../../infra/.env.example", import.meta.url), "utf8"),
	);
	const user = parseEnvValues(
		readFileSync(
			new URL("../../apps/user/.env.example", import.meta.url),
			"utf8",
		),
	);
	expect(user.S3_ACCESS_KEY_ID).toBe(infrastructure.S3_ACCESS_KEY_ID);
	expect(user.S3_SECRET_ACCESS_KEY).toBe(infrastructure.S3_SECRET_ACCESS_KEY);
});
