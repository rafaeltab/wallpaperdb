import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeCommand } from "../lib/boat-hillclimb.mjs";
import { sourceIdentity } from "../lib/boat-source-identity.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const hash = (b) => createHash("sha256").update(b).digest("hex");
export const pin = (file) => ({
	path: file,
	bytes: fs.statSync(file).size,
	sha256: hash(fs.readFileSync(file)),
	mode: fs.statSync(file).mode & 0o777,
});

export function sourcePreparationFixture(
	t,
	{ wanted = true, strings = false, fault = "" } = {},
) {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), "boat-owned-preparation-"),
	);
	const base = path.join(directory, "base"),
		root = path.join(directory, "worktree");
	const home = path.join(directory, "home");
	fs.mkdirSync(base);
	fs.mkdirSync(home);
	let retentionName;
	t.after(() => {
		try {
			const destination = process.env.BOAT_SOURCE_IDENTITY_EVIDENCE;
			if (destination && retentionName) {
				fs.mkdirSync(path.join(destination, retentionName), {
					recursive: true,
					mode: 0o700,
				});
				for (const entry of [
					"authority.json",
					"public-command",
					"preparation",
					"controlled-provider-calls.jsonl",
				])
					if (fs.existsSync(path.join(directory, entry)))
						fs.cpSync(
							path.join(directory, entry),
							path.join(destination, retentionName, entry),
							{ recursive: true },
						);
			}
		} finally {
			fs.rmSync(directory, { recursive: true, force: true });
			const destination = process.env.BOAT_SOURCE_IDENTITY_EVIDENCE;
			if (destination && retentionName)
				fs.writeFileSync(
					path.join(destination, retentionName, "fixture-cleanup.json"),
					JSON.stringify({
						directory,
						removed: !fs.existsSync(directory),
						measuredSourceTouched: false,
					}) + "\n",
					{ mode: 0o600, flag: "wx" },
				);
		}
	});
	const git = (...args) =>
		execFileSync("git", args, { cwd: base, stdio: ["pipe", "pipe", "pipe"] });
	git("init", "-q");
	fs.writeFileSync(
		path.join(base, ".gitignore"),
		".boat/\n.mise/\nscripts\n.worktree\n",
	);
	fs.writeFileSync(
		path.join(base, "Makefile"),
		`include ${repository}/Makefile\noverride SHELL := /bin/sh\n`,
	);
	fs.writeFileSync(
		path.join(base, "unrelated"),
		"unrelated sibling must survive\n",
	);
	for (let i = 0; i < 9; i++)
		fs.writeFileSync(path.join(base, `tracked-${i}`), `selected-${i}\n`);
	git("add", ".");
	git(
		"-c",
		"user.name=fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"-qm",
		"independent selected bytes",
	);
	git("worktree", "add", "-q", "--detach", root, "HEAD");
	fs.symlinkSync(path.join(repository, "scripts"), path.join(root, "scripts"));
	const key = hash(root).slice(0, 12),
		boat = path.join(root, ".boat");
	fs.mkdirSync(boat);
	fs.mkdirSync(path.join(root, ".mise/boat"), { recursive: true });
	fs.writeFileSync(
		path.join(root, ".worktree"),
		"WORKTREE_SLOT=276\nCOMPOSE_PROJECT_NAME=controlled-source\nINGRESS_PORT=10760\n",
	);
	const stop = {
		id: "controlled-existing-stop",
		status: "completed",
		forced: false,
		error: null,
		endedAt: "2026-11-05T00:00:00.000Z",
	};
	const state = {
		id: "controlled-stopped-worker",
		runningSince: null,
		developmentWanted: wanted,
		cost: 0.25,
		snapshotRecovery: {
			status: "DIRTY",
			workerId: "controlled-stopped-worker",
			reason: "authoritative-container-inventory-contract-unqualified",
		},
		admission: {
			token: "controlled-admission",
			status: "published",
			owner: { root, key },
			name: "controlled-source",
			candidate: {
				id: "controlled-stopped-worker",
				size: "large",
				name: "controlled-source",
			},
		},
		shutdownAttempt: {
			status: "completed-observed",
			workerId: "controlled-stopped-worker",
			submittedAt: "2026-11-05T00:00:00.000Z",
			accountingAppliedAt: "2026-11-05T00:00:01.000Z",
			completion: {
				workerId: "controlled-stopped-worker",
				status: "stopped",
				provider: { id: "controlled-stopped-worker", state: "stopped", stop },
			},
		},
	};
	fs.writeFileSync(
		path.join(boat, "enrollment.json"),
		JSON.stringify({
			root,
			key,
			size: "large",
			mode: "development",
			cohort: "c",
			lifecycle: "fresh-after-stop",
		}),
	);
	fs.writeFileSync(path.join(boat, "state.json"), JSON.stringify(state));
	const external = path.join(
		home,
		".local/state/wallpaperdb-boat/557",
		`${key}.worker.json`,
	);
	fs.mkdirSync(path.dirname(external), { recursive: true });
	fs.copyFileSync(path.join(boat, "state.json"), external);
	for (const name of [
		"source-modes.json",
		"manifest.json",
		"usage.json",
		"cache-server.json",
		"cache.json",
	])
		fs.writeFileSync(path.join(boat, name), "{}");
	const calls = path.join(directory, "controlled-provider-calls.jsonl");
	fs.writeFileSync(
		path.join(root, ".mise/boat/boat"),
		`#!/usr/bin/env node
const fs=require('fs'),cp=require('child_process');const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
const s=JSON.parse(fs.readFileSync('.boat/state.json'));
if(args.includes('info'))console.log(JSON.stringify({sandbox:{id:s.id,name:s.admission.name,type:'large',state:'stopped',stop:s.shutdownAttempt.completion.provider.stop}}));
else if(args.includes('usage')){
 if(${JSON.stringify(fault)}==='after-intent')cp.execFileSync('python',['-c','import os;os.utime("tracked-0",ns=(1793841786244371690,1793841786244371690))']);
 console.log('{}');
}else {console.error('CONTROL REFUSES EFFECT '+JSON.stringify(args));process.exitCode=97;}
`,
		{ mode: 0o700 },
	);
	const files = [];
	for (let i = 0; i < 28; i++) {
		const relative = i < 9 ? `tracked-${i}` : `created-${i - 9}`;
		fs.writeFileSync(path.join(root, relative), `owned-change-${i}\n`, {
			mode: 0o600,
		});
		fs.chmodSync(path.join(root, relative), 0o600);
		files.push({
			path: path.join(root, relative),
			relative,
			gitStatus: i < 9 ? " M" : "??",
		});
	}
	const cwdGit = (...args) => execFileSync("git", args, { cwd: root });
	const head = cwdGit("rev-parse", "HEAD").toString().trim();
	const controls = [
		".git",
		".worktree",
		".boat/state.json",
		".boat/enrollment.json",
		".boat/source-modes.json",
		".boat/manifest.json",
		".boat/usage.json",
		".boat/cache-server.json",
		".boat/cache.json",
	].map((p) => pin(path.join(root, p)));
	controls.push(
		pin(external),
		pin(
			path.resolve(
				root,
				cwdGit("rev-parse", "--git-path", "index").toString().trim(),
			),
		),
	);
	const data = {
		root,
		head,
		tree: cwdGit("rev-parse", "HEAD^{tree}").toString().trim(),
		key,
		snapshotRecovery: state.snapshotRecovery,
		worker: state.id,
		admission: state.admission.token,
		developmentWanted: wanted,
		stop,
		accountingAppliedAt: state.shutdownAttempt.accountingAppliedAt,
		cost: "0.25",
		controls,
		files,
		statusText: cwdGit("status", "--porcelain=v1", "-uall", "-z")
			.toString()
			.replaceAll("\0", "\n"),
		selectedTrackedRestores: files.slice(0, 9).map((file, i) => ({
			relative: file.relative,
			selectedRevision: head,
			gitMode: "100644",
			gitBlob: cwdGit("rev-parse", `${head}:${file.relative}`)
				.toString()
				.trim(),
			bytes: Buffer.byteLength(`selected-${i}\n`),
			sha256: hash(`selected-${i}\n`),
			preserveFilesystemMode: 0o600,
		})),
	};
	const authority = path.join(directory, "authority.json");
	fs.writeFileSync(authority, JSON.stringify(data));
	// Real Python JSON encoding of native integers, with an independent exact
	// timestamp literal. No text replacement or already-parsed unsafe Number.
	execFileSync("python", [
		"-c",
		`import os,json,sys,hashlib
p=sys.argv[1];x=json.load(open(p))
for f in x['files']:
 os.utime(f['path'],ns=(1793841786244371689,1793841786244371689))
 s=os.lstat(f['path']);b=open(f['path'],'rb').read()
 f.update(device=s.st_dev,inode=s.st_ino,mtimeNs=s.st_mtime_ns,uid=s.st_uid,gid=s.st_gid,mode=s.st_mode&511,linkCount=s.st_nlink,bytes=len(b),sha256=hashlib.sha256(b).hexdigest())
json.dump(x,open(p,'w'))`,
		authority,
	]);
	if (strings) {
		const canonical = {
			...data,
			files: files.map((file) => ({ ...file, ...sourceIdentity(file.path) })),
		};
		fs.writeFileSync(authority, JSON.stringify(canonical));
	}
	if (fault === "before-intent")
		execFileSync("python", [
			"-c",
			"import os,sys;os.utime(sys.argv[1],ns=(1793841786244371690,1793841786244371690))",
			files[0].path,
		]);
	const config = path.join(directory, "config.json"),
		evidence = path.join(directory, "preparation");
	fs.writeFileSync(
		config,
		JSON.stringify({ authority: pin(authority), evidence }),
	);
	const env = { ...process.env, HOME: home };
	for (const name of [
		"MAKEFLAGS",
		"MFLAGS",
		"MAKEOVERRIDES",
		"PACKAGE",
		"SCRIPT",
		"ARGS",
		"BOAT_EXEC",
	])
		delete env[name];
	return {
		directory,
		root,
		authority,
		evidence,
		calls,
		files,
		state,
		config,
		retain: (name) => {
			retentionName = name;
		},
		run: () =>
			makeCommand(
				[
					"make",
					"run",
					"PACKAGE=scripts",
					"SCRIPT=boat:prepare-source",
					`ARGS=${config}`,
					"SHELL=/bin/sh",
				],
				{
					cwd: repository,
					env,
					directory: path.join(directory, "public-command"),
					deadline: Number(process.hrtime.bigint()) / 1e9 + 60,
					disposalMs: 5000,
				},
			),
	};
}
