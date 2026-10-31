import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function installationInputs(tracked) {
	return [
		"pnpm-lock.yaml",
		"mise.lock",
		"mise.toml",
		"pnpm-workspace.yaml",
		...tracked.filter(
			(name) =>
				/(^|\/)(package.json|\.npmrc|\.env.example)$/.test(name) ||
				name.startsWith("patches/"),
		),
		"scripts/setup-worktree.mjs",
		"scripts/lib/env-pipeline.mjs",
		"scripts/lib/worktree-project.mjs",
	];
}

export const generatedAuthority = [
	"apps/asset/.authority.json",
	"infra/nats/.generated.conf",
	"infra/.operator-inbox.json",
	"apps/user/.workflow.json",
	"apps/wallpaper/.workflow.json",
];
export function projectedInputs(root) {
	return [
		".worktree",
		"infra/.env",
		...fs
			.readdirSync(path.join(root, "apps"))
			.filter((name) =>
				fs.existsSync(path.join(root, "apps", name, ".env.example")),
			)
			.map((name) => `apps/${name}/.env`),
		...generatedAuthority,
	];
}
export function fingerprint(root, names) {
	const digest = createHash("sha256");
	for (const name of [...names].sort()) {
		const file = path.join(root, name);
		const stat = fs.lstatSync(file);
		if (!stat.isFile())
			throw new Error(`Preparation requires regular file: ${name}`);
		digest
			.update(name)
			.update(String(stat.mode & 0o777))
			.update("\0")
			.update(fs.readFileSync(file))
			.update("\0");
	}
	return digest.digest("hex");
}
export function validateAuthority(root) {
	const env = fs.readFileSync(path.join(root, "apps/user/.env"), "utf8");
	const value = (name) =>
		env
			.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]
			?.trim()
			.replace(/^['"]|['"]$/g, "");
	const domain =
		value("CLERK_DOMAIN") ||
		Buffer.from(
			(value("CLERK_PUBLISHABLE_KEY") ?? "").replace(/^pk_(test|live)_/, ""),
			"base64",
		)
			.toString()
			.replace(/\$$/, "");
	const issuer = new URL(
		domain.startsWith("https://") ? domain : `https://${domain}`,
	).origin;
	const port = fs
		.readFileSync(path.join(root, ".worktree"), "utf8")
		.match(/^INGRESS_PORT\s*[:?]?=\s*(\d+)/m)?.[1];
	if (!port || !domain || domain.includes("unconfigured"))
		throw new Error(
			"Configured Clerk issuer and worktree ingress are required",
		);
	const authority = JSON.parse(
		fs.readFileSync(path.join(root, generatedAuthority[0]), "utf8"),
	);
	const clerk = authority.identityProviders.clerk;
	if (
		clerk.issuer !== issuer ||
		clerk.jwksUrl !== `${issuer}/.well-known/jwks.json` ||
		![`http://localhost:${port}`, `http://127.0.0.1:${port}`].every((origin) =>
			clerk.authorizedParties.includes(origin),
		)
	)
		throw new Error(
			"Generated authority does not match configured Clerk issuer/JWKS/ingress",
		);
	for (const name of generatedAuthority) {
		if (!fs.lstatSync(path.join(root, name)).isFile())
			throw new Error(`Preparation requires regular file: ${name}`);
	}
}

export async function prepareEnvironment({
	root,
	previous,
	configuration,
	dependencies,
	generate,
	project,
	install,
	validateMounts,
	persist,
}) {
	const complete = configuration.every((name) =>
		fs.existsSync(path.join(root, name)),
	);
	let identity = complete ? fingerprint(root, configuration) : null;
	if (identity !== previous.identity) {
		await generate();
		validateAuthority(root);
		identity = fingerprint(root, configuration);
		await project();
		if (dependencies !== previous.dependencies) {
			await install();
			await project();
		}
		await validateMounts();
		await persist({ identity, dependencies });
		return { changed: true };
	}
	validateAuthority(root);
	await validateMounts();
	return { changed: false };
}
