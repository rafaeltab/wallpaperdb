export interface EnvContext {
	projectName?: string;
	ports?: Record<string, number>;
	repoRoot?: string;
}
import { randomBytes } from "node:crypto";

export function parseEnvValues(content: string) {
	const values: Record<string, string> = Object.create(null);
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
		if (match) {
			let value = match[2];
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			values[match[1]] = value;
		}
	}
	return values;
}

export function applyOverrides(
	exampleContent: string,
	overrides: Record<string, string | undefined | ((ctx: EnvContext) => string)>,
	ctx: EnvContext,
) {
	const resolved: Record<string, string | undefined> = {};
	for (const [key, val] of Object.entries(overrides)) {
		resolved[key] = typeof val === "function" ? val(ctx) : val;
	}

	const lines = exampleContent.split("\n");
	const seen = new Set();

	const updatedLines = lines.map((line: string) => {
		const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (match) {
			const key = match[1];
			if (key in resolved) {
				seen.add(key);
				return `${key}=${resolved[key]}`;
			}
		}
		return line;
	});

	for (const [key, value] of Object.entries(resolved)) {
		if (!seen.has(key)) {
			updatedLines.push(`${key}=${value}`);
		}
	}

	return updatedLines.join("\n");
}

export function extractKeys(content: string) {
	return new Set(
		content
			.split("\n")
			.map((l: string) => l.match(/^([A-Z0-9_]+)=/))
			.filter((m): m is RegExpMatchArray => m !== null)
			.map((m) => m[1]),
	);
}

export function filterApplicableSecrets(
	secrets: Record<string, string>,
	exampleKeys: Set<string>,
	dir: string,
	log: (message: string) => void,
) {
	const applicable: Record<string, string> = {};
	for (const [key, value] of Object.entries(secrets)) {
		if (value === "") continue;
		if (exampleKeys.has(key)) {
			applicable[key] = value;
		} else {
			log(
				`[setup-worktree] Secret '${key}' not found in ${dir}/.env.example — skipped.`,
			);
		}
	}
	return applicable;
}

export const knownUserSecrets = {
	CURSOR_SECRET: () => randomBytes(32).toString("hex"),
	USER_MEDIA_SERVICE_TOKEN: () => randomBytes(32).toString("hex"),
	VITE_CLERK_PUBLISHABLE_KEY: undefined,
	CLERK_DOMAIN: undefined,
	CLERK_SECRET_KEY: undefined,
	CLERK_PUBLISHABLE_KEY: undefined,
	E2E_BASE_TEST_EMAIL: undefined,
	E2E_BASE_TEST_PASSWORD: undefined,
};

export function syncKnownSecretsToContent(
	existingContent: string,
	secrets: Record<string, (() => string) | undefined>,
) {
	const existingKeys = new Set(
		existingContent
			.split("\n")
			.map((l: string) => l.match(/^([A-Z0-9_]+)=/))
			.filter((m): m is RegExpMatchArray => m !== null)
			.map((m) => m[1]),
	);

	const toAppend = [];
	for (const [key, generator] of Object.entries(secrets)) {
		if (!existingKeys.has(key)) {
			const value = generator ? generator() : "";
			toAppend.push(`${key}=${value}`);
		}
	}

	if (toAppend.length === 0) return existingContent;
	const separator =
		existingContent && !existingContent.endsWith("\n") ? "\n" : "";
	return `${existingContent + separator + toAppend.join("\n")}\n`;
}

export function resolveGenerateMarker(
	content: string,
	secrets: Record<string, (() => string) | undefined>,
) {
	let updated = content;
	const parsed = parseEnvValues(content);
	const result: Record<string, string> = {};

	for (const [key, value] of Object.entries(parsed)) {
		if (value === "{GENERATE}" && secrets[key]) {
			const generated = secrets[key]();
			result[key] = generated;
			updated = updated.replace(
				new RegExp(`^${key}=\\{GENERATE\\}$`, "m"),
				`${key}=${generated}`,
			);
		} else {
			result[key] = value;
		}
	}

	return { secrets: result, content: updated };
}
