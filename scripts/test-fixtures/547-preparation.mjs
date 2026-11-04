import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import * as runner from "../lib/boat-hillclimb.mjs";
import { objects547 } from "./547-inputs.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const mono = () => Number(process.hrtime.bigint()) / 1e9;

async function servingPorts(t) {
	const leases = path.join(os.tmpdir(), "wallpaperdb-547-test-ports");
	fs.mkdirSync(leases, { recursive: true, mode: 0o700 });
	const until = mono() + 5;
	while (mono() < until) {
		const sockets = [net.createServer(), net.createServer()],
			claimed = [];
		const release = async () =>
			Promise.all(
				sockets.map((server) =>
					server.listening
						? new Promise((resolve, reject) =>
								server.close((error) => (error ? reject(error) : resolve())),
							)
						: undefined,
				),
			);
		const remove = () => {
			for (const file of claimed) fs.unlinkSync(file);
		};
		try {
			const listen = (server, port) =>
				new Promise((resolve, reject) => {
					server.once("error", reject);
					server.listen(port, "127.0.0.1", resolve);
				});
			await listen(sockets[0], 0);
			const ingress = sockets[0].address().port;
			if (ingress + 20000 > 65535) {
				await release();
				continue;
			}
			// Keep a cooperative lease through the listener handoff. Other fixture
			// processes cannot choose these ports between reservation and startup.
			for (const port of [ingress, ingress + 20000]) {
				const file = path.join(leases, String(port));
				const fd = fs.openSync(file, "wx", 0o600);
				fs.closeSync(fd);
				claimed.push(file);
			}
			await listen(sockets[1], ingress + 20000);
			t.after(async () => {
				await release();
				remove();
			});
			return { ingress, release };
		} catch (error) {
			await release();
			remove();
			if (!["EADDRINUSE", "EEXIST"].includes(error.code)) throw error;
		}
	}
	throw new Error("No isolated #547 serving port pair available");
}

export function preparationFixture(t, nativeObjects = false) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "boat-preparation-"));
	fs.writeFileSync(
		path.join(root, "Makefile"),
		`include ${repository}/Makefile\noverride SHELL := /bin/sh\n`,
	);
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const workload = json(
		path.join(repository, "scripts/boat-workloads/547.json"),
	);
	if (nativeObjects) {
		const appArchive = execFileSync(
			"git",
			["archive", workload.productBase, "apps"],
			{ cwd: repository, maxBuffer: 32 * 1024 * 1024 },
		);
		assert.equal(
			spawnSync("tar", ["xf", "-"], { cwd: root, input: appArchive }).status,
			0,
		);
		for (const [file, blob] of [
			["pnpm-lock.yaml", workload.inputs.initialLock.gitBlob],
			[
				"pnpm-workspace.yaml",
				workload.resolutionDiagnostic.baselineWorkspaceBlob,
			],
		])
			fs.writeFileSync(
				path.join(root, file),
				execFileSync("git", ["cat-file", "blob", blob], { cwd: repository }),
			);
	} else {
		for (const item of objects547.baselineApps()) {
			const file = path.join(root, item.path);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, objects547.readBlob(item.blob), {
				mode: item.mode === "100755" ? 0o755 : 0o644,
			});
		}
		fs.writeFileSync(
			path.join(root, "pnpm-lock.yaml"),
			objects547.readBlob(workload.inputs.initialLock.gitBlob),
		);
		fs.writeFileSync(
			path.join(root, "pnpm-workspace.yaml"),
			objects547.readBlob(workload.resolutionDiagnostic.baselineWorkspaceBlob),
		);
	}
	fs.writeFileSync(
		path.join(root, ".worktree"),
		"WORKTREE_SLOT=276\nCOMPOSE_PROJECT_NAME=wallpaperdb-control\nINGRESS_PORT=10760\n",
	);
	fs.mkdirSync(path.join(root, "bin"));
	const nativeMake = execFileSync("which", ["make"], {
		encoding: "utf8",
	}).trim();
	fs.writeFileSync(
		path.join(root, "bin/make"),
		`#!/usr/bin/env node
const {spawnSync}=require('node:child_process');const args=process.argv.slice(2);const r=spawnSync(${JSON.stringify(nativeMake)},['-f','controlled.mk',...args],{stdio:'inherit',env:{...process.env,CONTROL_MAKE_ARGV:JSON.stringify(['make',...args])}});process.exitCode=r.status??1;
`,
		{ mode: 0o700 },
	);
	fs.writeFileSync(
		path.join(root, "controlled.mk"),
		`.PHONY: boat-enroll boat-prepare-toolchain boat-prepare-workspace boat-prepare-chromium boat-prepare-app-images test-focused toolchain run build check docker-run boat-prepare-infra-images boat-stop infra-start apps-build apps-start dev boat-preview\nboat-enroll boat-prepare-toolchain boat-prepare-workspace boat-prepare-chromium boat-prepare-app-images test-focused toolchain run build check docker-run boat-prepare-infra-images boat-stop infra-start apps-build apps-start:\n\t@node ${repository}/scripts/test-fixtures/547-make-effect.cjs\ndev boat-preview:\n\t@node ${repository}/scripts/test-fixtures/547-serving-effect.mjs $(if $(filter dev,$@),dev,preview)\n`,
	);
	const env = {
		...process.env,
		MAKEFLAGS: "",
		MFLAGS: "",
		PATH: `${root}/bin:${process.env.PATH}`,
		CONTROL_REPOSITORY: repository,
		CONTROL_PROJECT: "wallpaperdb-control",
	};
	// These belong to the Make invocation running the test, not its isolated
	// repository-wide controlled worker commands.
	for (const name of ["PACKAGE", "SERVICE", "SCRIPT", "ARGS", "BOAT_EXEC"])
		delete env[name];
	const config = {
		worktree: root,
		round: "fresh-stable",
		evidence: path.join(root, "evidence"),
	};
	const observeCli = (file) => ({
		path: file,
		sha256: json(
			path.join(repository, "scripts/boat-workloads/547-preparation.json"),
		).cliSha256,
	});
	let portPromise;
	const f = {
		root,
		config,
		env,
		observeCli,
		servingPorts: () =>
			(portPromise ??= servingPorts(t).then((ports) => {
				const file = path.join(root, ".worktree");
				fs.writeFileSync(
					file,
					fs
						.readFileSync(file, "utf8")
						.replace(/^INGRESS_PORT=10760$/m, `INGRESS_PORT=${ports.ingress}`),
				);
				return ports;
			})),
		make: async (argv, options) => {
			if (options.serving && argv[1] === "boat-preview")
				await (await f.servingPorts()).release();
			return runner.makeCommand(argv, {
				...options,
				env: { ...env, CONTROL_MAKE_ARGV: JSON.stringify(argv) },
			});
		},
	};
	f.run = async (extra = {}) => {
		if (config.until === "ready") await f.servingPorts();
		return runner.execute547Preparation(config, {
			make: f.make,
			observeCli,
			objects: nativeObjects ? undefined : objects547,
			...extra,
		});
	};
	return f;
}

// Public CLI controls share actual product Git objects and the same qualified
// bootstrap artifact. Only the Make/Docker external effects are controlled.
export async function publicPreparationFixture(t, cli) {
	const f = preparationFixture(t, true);
	f.config.until = "ready";
	await (await f.servingPorts()).release();
	fs.symlinkSync(
		path.join(repository, "scripts"),
		path.join(f.root, "scripts"),
	);
	fs.mkdirSync(path.join(f.root, ".mise/boat"), { recursive: true });
	fs.copyFileSync(cli, path.join(f.root, ".mise/boat/boat"));
	fs.writeFileSync(
		path.join(f.root, "bin/docker"),
		`#!/bin/sh\nexec node ${repository}/scripts/test-fixtures/547-docker-effect.cjs "$@"\n`,
		{ mode: 0o700 },
	);
	return f;
}
