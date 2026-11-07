interface Compose {
	services?: Record<
		string,
		{
			build?: { dockerfile?: string };
			healthcheck?: { test?: string[]; disable?: boolean };
			env_file?: (string | { path: string })[];
		}
	>;
}
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { command } from "./lib/agent-command.ts";
function files(directory: string): string[] {
	if (!fs.existsSync(directory)) return [];
	return fs
		.readdirSync(directory, { withFileTypes: true })
		.flatMap((e) =>
			e.isDirectory()
				? files(path.join(directory, e.name))
				: [path.join(directory, e.name)],
		);
}
export function checkServiceWiring(root: string, compose: Compose) {
	const errors = [];
	const ingress = fs.readFileSync(
		path.join(root, "infra/caddy/Caddyfile"),
		"utf8",
	);
	const template = fs.readFileSync(
		path.join(root, "api/environments/local.bru.example"),
		"utf8",
	);
	for (const entry of fs.readdirSync(path.join(root, "apps"), {
		withFileTypes: true,
	})) {
		const workspace = `apps/${entry.name}`;
		if (
			!entry.isDirectory() ||
			!fs.existsSync(path.join(root, workspace, "Dockerfile"))
		)
			continue;
		const match = Object.entries(compose.services ?? {}).find(([, service]) =>
			service.build?.dockerfile?.startsWith(`${workspace}/`),
		);
		if (!match) {
			errors.push(`${workspace}: missing Compose service`);
			continue;
		}
		const [name, service] = match;
		if (!fs.existsSync(path.join(root, service.build!.dockerfile!)))
			errors.push(`${workspace}: missing development Dockerfile`);
		if (!service.healthcheck?.test?.length || service.healthcheck.disable)
			errors.push(`${workspace}: missing Compose health check`);
		if (!fs.existsSync(path.join(root, workspace, ".env.example")))
			errors.push(`${workspace}: missing environment template`);
		if (
			!service.env_file?.some(
				(file) =>
					path.resolve(typeof file === "string" ? file : file.path) ===
					path.join(root, workspace, ".env"),
			)
		)
			errors.push(
				`${workspace}: Compose must consume its generated environment`,
			);
		if (!ingress.includes(`reverse_proxy ${name}:`))
			errors.push(`${workspace}: missing ingress target`);
		const requests = files(path.join(root, "api", entry.name))
			.filter((file) => file.endsWith(".bru"))
			.map((file) => fs.readFileSync(file, "utf8"));
		const health = requests.find((source) =>
			/url:\s*\{\{\w+\}\}\/health\b/.test(source),
		);
		if (!health) errors.push(`${workspace}: missing Bruno health request`);
		for (const source of requests) {
			const variable = source.match(/url:\s*\{\{(\w+)\}\}/)?.[1];
			if (variable && !new RegExp(`\\b${variable}:`).test(template))
				errors.push(
					`${workspace}: Bruno URL variable ${variable} is absent from its environment template`,
				);
		}
	}
	return errors;
}
if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const root = fileURLToPath(new URL("../", import.meta.url));
	const compose: Compose = JSON.parse(
		command("docker", [
			"compose",
			"-f",
			"infra/docker-compose.apps.yml",
			"config",
			"--format",
			"json",
			"--no-interpolate",
			"--no-env-resolution",
		]),
	);
	const errors = checkServiceWiring(root, compose);
	if (errors.length) {
		console.error(errors.join("\n"));
		process.exitCode = 1;
	} else
		console.log(
			"Compose, environment templates, health requests and ingress wiring verified. Review startup dependencies and public route coverage for the selected change.",
		);
}
