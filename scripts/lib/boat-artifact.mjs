import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const destination = ".boat/artifacts/553-animation.webp";
const workerOutput = "/tmp/553-animation.webp";
const maximumBytes = 1024 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const selectors = [
	"test-focused",
	"PACKAGE=asset",
	"ARGS=--config vitest.integration.config.ts test/source-storage.integration.test.ts -t 1850-frame",
];

// Only the declared, instrumented owning test produces this artifact.
export function artifactCommand(root, targets) {
	return (
		targets.length === selectors.length &&
		targets[0] === selectors[0] &&
		selectors.slice(1).every((selector) => targets.includes(selector)) &&
		digest(
			fs.readFileSync(
				path.join(root, "apps/asset/test/source-storage.integration.test.ts"),
			),
		) === "5ab23163476a0dc0fd43b487f24ea87440750b358d3bf0450b8ac7ab34d586bd"
	);
}

function directory(root, name) {
	let current = root;
	for (const part of name.split("/")) {
		current = path.join(current, part);
		try {
			fs.mkdirSync(current, { mode: 0o700 });
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
		}
		if (!fs.lstatSync(current).isDirectory())
			throw new Error("Artifact ancestor is not a directory");
	}
	return current;
}
function readFile(file) {
	const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
	try {
		const before = fs.fstatSync(fd, { bigint: true });
		if (
			!before.isFile() ||
			before.nlink !== 1n ||
			before.size > BigInt(maximumBytes)
		)
			throw new Error("Artifact requires a bounded independent regular file");
		const bytes = fs.readFileSync(fd),
			after = fs.fstatSync(fd, { bigint: true }),
			entry = fs.lstatSync(file, { bigint: true });
		const tuple = (s) =>
			[s.dev, s.ino, s.mode, s.uid, s.gid, s.size, s.mtimeNs, s.ctimeNs].map(
				String,
			);
		if (
			JSON.stringify(tuple(before)) !== JSON.stringify(tuple(after)) ||
			JSON.stringify(tuple(after)) !== JSON.stringify(tuple(entry))
		)
			throw new Error("Artifact changed during read");
		return { bytes, identity: { native: tuple(after), sha256: digest(bytes) } };
	} finally {
		fs.closeSync(fd);
	}
}
export function artifactDestination(root) {
	directory(root, ".boat");
	const parent = path.join(root, ".boat/artifacts");
	if (fs.existsSync(parent) && !fs.lstatSync(parent).isDirectory())
		throw new Error("Artifact ancestor is not a directory");
	try {
		return readFile(path.join(root, destination)).identity;
	} catch (error) {
		if (error.code === "ENOENT") return null;
		if (error.code === "ELOOP")
			throw new Error("Artifact destination must be a regular file");
		throw error;
	}
}

export function acceptArtifact(root, before, encoded) {
	const bytes = Buffer.from(encoded.data ?? "", "base64");
	if (
		!bytes.length ||
		bytes.length > maximumBytes ||
		bytes.length !== encoded.bytes ||
		bytes.toString("base64") !== encoded.data ||
		(encoded.sha256 !== undefined && digest(bytes) !== encoded.sha256)
	)
		throw new Error("Invalid artifact transfer");
	const proposals = directory(root, ".boat/artifact-proposals");
	const proposal = path.join(proposals, randomBytes(12).toString("hex"));
	const fd = fs.openSync(proposal, "wx", 0o600);
	try {
		fs.writeFileSync(fd, bytes);
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	if (JSON.stringify(artifactDestination(root)) !== JSON.stringify(before))
		throw new Error(`Local artifact changed; proposal retained at ${proposal}`);
	directory(root, ".boat/artifacts");
	const output = path.join(root, destination);
	fs.renameSync(proposal, output);
	const parent = fs.openSync(path.dirname(output), "r");
	try {
		fs.fsyncSync(parent);
	} finally {
		fs.closeSync(parent);
	}
	return { path: output, bytes: bytes.length, sha256: digest(bytes) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.argv[2] === "prepare") {
		const token = randomBytes(12).toString("hex");
		const owned = directory(
			process.cwd(),
			`.boat/artifact-generation-${token}`,
		);
		try {
			readFile(workerOutput);
			fs.renameSync(workerOutput, path.join(owned, "previous.webp"));
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		fs.writeFileSync(path.join(owned, "prepared"), token, {
			flag: "wx",
			mode: 0o600,
		});
		console.log(JSON.stringify({ token }));
	} else if (process.argv[2] === "collect") {
		const token = process.argv[3];
		if (!/^[a-f0-9]{24}$/.test(token ?? ""))
			throw new Error("Invalid artifact owner");
		const marker = path.join(
			process.cwd(),
			`.boat/artifact-generation-${token}/prepared`,
		);
		if (fs.readFileSync(marker, "utf8") !== token)
			throw new Error("Missing artifact preparation");
		const { bytes, identity } = readFile(workerOutput);
		console.log(
			JSON.stringify({
				token,
				bytes: bytes.length,
				sha256: identity.sha256,
				data: bytes.toString("base64"),
			}),
		);
	} else throw new Error("Unknown artifact operation");
}
