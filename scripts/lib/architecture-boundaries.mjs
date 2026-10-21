import path from "node:path";

// Shared ownership model. Capability directories and quality.config.json remain authoritative.
export function backendBoundaries(src, config, capabilityNames) {
	const capabilitiesRoot = path.join(src, "capabilities");
	function capability(filename) {
		const relative = path.relative(capabilitiesRoot, filename);
		if (relative.startsWith("..") || path.isAbsolute(relative))
			return undefined;
		const segment = relative.split(path.sep)[0];
		return capabilityNames.has(segment) ? segment : undefined;
	}

	function publicModule(filename) {
		const relative = path.relative(src, filename).split(path.sep).join("/");
		const capabilityName = capability(filename);
		if (capabilityName) return `capabilities/${capabilityName}`;
		return config.publicModules.find((module) =>
			relative.startsWith(`${module}/`),
		);
	}

	return { capability, publicModule };
}
