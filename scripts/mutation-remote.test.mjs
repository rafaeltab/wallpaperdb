import assert from "node:assert/strict";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { downloadBaseline } from "./lib/mutation-remote.mjs";
import { restoreBaseline } from "./lib/mutation-state.mjs";

test("CI exchange skips PR runs and incompatible artifacts, and imports portable main state", (t) => {
	const root = mkdtempSync(join(tmpdir(), "mutation-remote-"));
	const previous = process.env.PATH;
	t.after(() => {
		process.env.PATH = previous;
		rmSync(root, { recursive: true, force: true });
	});
	const context = {
		root,
		workspace: "packages/demo",
		suite: "unit",
		key: "a".repeat(64),
		inputDigest: "b".repeat(64),
		cacheDirectory: join(root, "cache"),
	};
	const envelope = {
		version: 1,
		key: context.key,
		inputDigest: context.inputDigest,
		createdAt: new Date().toISOString(),
		report: { schemaVersion: "1.0", files: {}, testFiles: {} },
	};
	const gh = join(root, "gh");
	writeFileSync(
		gh,
		`#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(root, "calls"))}, JSON.stringify(args)+'\\n');
if (args[0] === 'repo') console.log(JSON.stringify({defaultBranchRef:{name:'main'}}));
else if (args[1] === 'list') console.log(JSON.stringify([{databaseId:3,event:'pull_request'},{databaseId:2,event:'workflow_dispatch'},{databaseId:1,event:'workflow_dispatch'}]));
else {
 const dir = args[args.indexOf('--dir')+1];
 const envelope = ${JSON.stringify(envelope)};
 if(args[2] === '2') envelope.key = 'wrong';
 fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(dir+'/checkpoint.json',JSON.stringify(envelope));
}
`,
	);
	chmodSync(gh, 0o700);
	process.env.PATH = `${root}:${previous}`;
	assert.equal(downloadBaseline(context), true);
	assert.equal(
		restoreBaseline(context).report.projectRoot,
		join(root, "packages/demo"),
	);
	const calls = readFileSync(join(root, "calls"), "utf8")
		.trim()
		.split("\n")
		.map(JSON.parse);
	assert.ok(
		calls.some(
			(args) =>
				args.includes("--branch") &&
				args.includes("main") &&
				args.includes("success"),
		),
	);
	assert.ok(!calls.some((args) => args[1] === "download" && args[2] === "3"));
	assert.equal(calls.filter((args) => args[1] === "download").length, 2);
});
