import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acceptArtifact, artifactDestination } from "./boat-artifact.mjs";

function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "boat-artifact-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.mkdirSync(path.join(root, ".boat"));
	return root;
}
const bytes = Buffer.from("independently generated artifact\n");
const encoded = () => ({ data: bytes.toString("base64"), bytes: bytes.length });

test("artifact publication returns worker output and survives unrelated source changes", (t) => {
	const root = fixture(t);
	const before = artifactDestination(root);
	const result = acceptArtifact(root, before, encoded());
	fs.writeFileSync(path.join(root, "ordinary-source.ts"), "changed");
	assert.deepEqual(fs.readFileSync(result.path), bytes);
	assert.equal(result.bytes, 33);
});

test("a concurrent local artifact edit wins and the generated proposal is retained", (t) => {
	const root = fixture(t);
	const before = artifactDestination(root);
	fs.mkdirSync(path.join(root, ".boat/artifacts"));
	fs.writeFileSync(
		path.join(root, ".boat/artifacts/553-animation.webp"),
		"local editor",
	);
	assert.throws(
		() => acceptArtifact(root, before, encoded()),
		/Local artifact changed.*proposal retained at/,
	);
	assert.equal(
		fs.readFileSync(
			path.join(root, ".boat/artifacts/553-animation.webp"),
			"utf8",
		),
		"local editor",
	);
	const proposals = fs.readdirSync(path.join(root, ".boat/artifact-proposals"));
	assert.equal(proposals.length, 1);
	assert.deepEqual(
		fs.readFileSync(path.join(root, ".boat/artifact-proposals", proposals[0])),
		bytes,
	);
});

test("artifact publication refuses a symlink destination and malformed transfer", (t) => {
	const root = fixture(t);
	assert.throws(
		() => acceptArtifact(root, null, { data: "%%%", bytes: 3 }),
		/Invalid artifact/,
	);
	fs.mkdirSync(path.join(root, ".boat/artifacts"), { recursive: true });
	const outside = path.join(root, "outside");
	fs.writeFileSync(outside, "unchanged");
	fs.symlinkSync(
		outside,
		path.join(root, ".boat/artifacts/553-animation.webp"),
	);
	assert.throws(() => artifactDestination(root), /regular file/);
	assert.equal(fs.readFileSync(outside, "utf8"), "unchanged");
});
