import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	provenOwnedSourceExit,
	runOwnedSourceCommand,
} from "./boat-source-command.mjs";

const command = "printf '%s' 'synthetic source command'";
const returnedCommand = "bash -lc <fixture-serialized-source-command>";
const processId = 42;
const startedAt = "2026-11-01T12:00:00.000Z";
const finishedAt = "2026-11-01T12:00:01.000Z";
const stdout = "generated source\n";
const stderr = "generator warning\n";
const offsets = {
	stdoutOffset: Buffer.byteLength(stdout),
	stderrOffset: Buffer.byteLength(stderr),
};

function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "boat-source-command-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const directory = path.join(root, "evidence");
	const cli = path.join(root, "synthetic-boat");
	fs.writeFileSync(cli, "This file is hashed but never executed.\n", {
		mode: 0o600,
	});
	const records = [];
	return {
		cli,
		directory,
		records,
		async run(execute) {
			return runOwnedSourceCommand({
				workerId: "worker_fixture",
				kind: "migrations",
				command,
				execute,
				cli,
				directory,
				persist: (record) => records.push(structuredClone(record)),
			});
		},
	};
}

function startReceipt() {
	return {
		success: true,
		processId,
		pid: 42,
		command: returnedCommand,
		startedAt,
	};
}

function statusReceipt(exitCode = 0) {
	return {
		success: true,
		known: true,
		processId,
		command: returnedCommand,
		startedAt,
		finishedAt,
		oomKilled: false,
		signal: null,
		status: "exited",
		running: false,
		exitCode,
		stdout,
		stderr,
	};
}

function attachFrames(exitCode = 0) {
	return [
		{ type: "attached", processId, stdoutOffset: 0, stderrOffset: 0 },
		{ type: "stdout", data: stdout, nextOffset: offsets.stdoutOffset },
		{ type: "stderr", data: stderr, nextOffset: offsets.stderrOffset },
		{ type: "exit", status: "exited", exitCode, signal: null, ...offsets },
	];
}

function rawJson(value) {
	return Buffer.from(` \t${JSON.stringify(value, null, 2)}\r\n`);
}

function observeJson(opts, receipt, close = { code: 0, signal: null }) {
	const bytes = rawJson(receipt);
	opts.sourceObservation.raw("stdout", bytes);
	if (close) opts.sourceObservation.close(close);
	return {
		status: 0,
		out: bytes.toString(),
		output: "",
		outputOverflow: false,
	};
}

function observeAttach(
	opts,
	frames = attachFrames(),
	close = { code: frames.at(-1).exitCode, signal: null },
) {
	for (const frame of frames) {
		opts.sourceObservation.raw(
			"stdout",
			Buffer.from(` \t${JSON.stringify(frame)}\r\n`),
		);
		opts.onFrame(frame);
		if (frame.type === "stdout" || frame.type === "stderr")
			opts.sourceObservation.output(frame.data, frame.type === "stderr");
	}
	if (close) opts.sourceObservation.close(close);
	return {
		status: close?.code ?? 0,
		out: "",
		output: frames
			.filter((frame) => frame.type === "stdout" || frame.type === "stderr")
			.map((frame) => frame.data)
			.join(""),
		outputOverflow: false,
	};
}

function phaseMetadata(f, name) {
	return JSON.parse(
		fs.readFileSync(path.join(f.directory, `${name}.json`), "utf8"),
	);
}

test("synthetic closure retains distinct raw CLI stderr, decoded CLI stderr, and remote output", async (t) => {
	const f = fixture(t);
	const cliStderr = Buffer.from("launcher diagnostic café\t\r\n");
	const result = await f.run(
		executeFixture({
			start: (opts, argv) => {
				assert.equal(f.records[0].start, null);
				assert.ok(argv.includes(command));
				return observeJson(opts, startReceipt());
			},
			attach: (opts) => {
				assert.deepEqual(f.records.at(-1).start, startReceipt());
				const observedFrame = opts.onFrame;
				opts.onFrame = (frame) => {
					assert.ok(
						fs
							.readFileSync(path.join(f.directory, "attach.stdout"), "utf8")
							.endsWith(` \t${JSON.stringify(frame)}\r\n`),
					);
					observedFrame(frame);
				};
				opts.sourceObservation.raw("stderr", cliStderr);
				assert.equal(
					opts.sourceObservation.localStderr(cliStderr.toString("utf8")),
					true,
				);
				return observeAttach(opts);
			},
		}),
	);
	assert.equal(result.status, 0);
	assert.equal(result.output, stdout + stderr);
	assert.equal(result.outputOverflow, false);
	assert.equal(provenOwnedSourceExit(f.records.at(-1)), true);
	assert.equal(fs.statSync(f.directory).mode & 0o777, 0o700);
	for (const name of fs.readdirSync(f.directory))
		assert.equal(
			fs.statSync(path.join(f.directory, name)).mode & 0o777,
			0o600,
			name,
		);
	const expected = {
		"start.stdout": rawJson(startReceipt()),
		"status.stdout": rawJson(statusReceipt()),
		"attach.stdout": Buffer.from(
			attachFrames()
				.map((frame) => ` \t${JSON.stringify(frame)}\r\n`)
				.join(""),
		),
		"attach.stderr": cliStderr,
		"attach.decoded-cli-stderr": cliStderr,
		"attach.decoded-stdout": Buffer.from(stdout),
		"attach.decoded-stderr": Buffer.from(stderr),
	};
	for (const [file, bytes] of Object.entries(expected)) {
		assert.deepEqual(
			fs.readFileSync(path.join(f.directory, file)),
			bytes,
			file,
		);
		const [phase, stream] = file.split(".");
		assert.deepEqual(phaseMetadata(f, phase).streams[stream], {
			bytes: bytes.length,
			observedBytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
	}
	for (const name of ["start", "attach", "status"]) {
		const meta = phaseMetadata(f, name);
		assert.equal(meta.closed, true);
		assert.equal(meta.complete, true);
		assert.equal(meta.overflow, false);
		assert.deepEqual(meta.localExit, { code: 0, signal: null });
		assert.equal(meta.artifact.version, null);
		assert.equal(
			meta.artifact.sha256,
			createHash("sha256").update(fs.readFileSync(f.cli)).digest("hex"),
		);
	}
	assert.deepEqual(phaseMetadata(f, "attach").events, [
		"attached",
		"stdout",
		"stderr",
		"exit",
	]);
});

test("malformed attachment preserves whitespace and invalid raw bytes instead of a reconstructed frame", async (t) => {
	const f = fixture(t);
	const raw = Buffer.concat([
		Buffer.from(" \t{broken JSON}\r\n"),
		Buffer.from([0xff, 0x00, 0x0a]),
	]);
	const diagnostic = Buffer.from("stderr is separate\r\n");
	await assert.rejects(
		f.run(
			executeFixture({
				attach: (opts) => {
					opts.sourceObservation.raw("stdout", raw.subarray(0, 5));
					opts.sourceObservation.raw("stdout", raw.subarray(5));
					opts.sourceObservation.raw("stderr", diagnostic);
					opts.sourceObservation.malformed();
					opts.sourceObservation.close({ code: 0, signal: null });
					return {
						status: 0,
						out: "",
						output: "normalized diagnostic",
						outputOverflow: false,
					};
				},
			}),
		),
		/completion is uncertain/,
	);
	assert.deepEqual(
		fs.readFileSync(path.join(f.directory, "attach.stdout")),
		raw,
	);
	assert.deepEqual(
		fs.readFileSync(path.join(f.directory, "attach.stderr")),
		diagnostic,
	);
	const meta = phaseMetadata(f, "attach");
	assert.equal(meta.malformed, true);
	assert.equal(meta.complete, false);
	assert.equal(f.records.at(-1).protocolError, true);
	assert.equal(provenOwnedSourceExit(f.records.at(-1)), false);
});

for (const [stream, limit] of [
	["stdout", 64 * 1024 * 1024],
	["stderr", 8 * 1024 * 1024],
]) {
	test(`raw ${stream} overflow retains only the bounded prefix and cannot authorize completion`, async (t) => {
		const f = fixture(t);
		const chunk = Buffer.alloc(1024 * 1024, 0x20);
		const expectedHash = createHash("sha256");
		await assert.rejects(
			f.run(
				executeFixture({
					start: (opts) => {
						for (let bytes = 0; bytes < limit; bytes += chunk.length) {
							opts.sourceObservation.raw(stream, chunk);
							expectedHash.update(chunk);
						}
						opts.sourceObservation.raw(stream, Buffer.from("!"));
						opts.sourceObservation.close({ code: 0, signal: null });
						return {
							status: 0,
							out: JSON.stringify(startReceipt()),
							output: "",
							outputOverflow: false,
						};
					},
				}),
			),
			/completion is uncertain/,
		);
		assert.equal(
			fs.statSync(path.join(f.directory, `start.${stream}`)).size,
			limit,
		);
		const meta = phaseMetadata(f, "start");
		assert.equal(meta.overflow, true);
		assert.equal(meta.complete, false);
		assert.deepEqual(meta.streams[stream], {
			bytes: limit,
			observedBytes: limit + 1,
			sha256: expectedHash.digest("hex"),
		});
		assert.equal(provenOwnedSourceExit(f.records.at(-1)), false);
	});
}

for (const extra of [0, 1]) {
	test(`decoded stdout and stderr ${extra ? "exceed" : "can reach"} the shared 8 MiB limit`, async (t) => {
		const f = fixture(t);
		const size = 4 * 1024 * 1024;
		const frames = [
			attachFrames()[0],
			{ type: "stdout", data: "s".repeat(size), nextOffset: size },
			{
				type: "stderr",
				data: "e".repeat(size + extra),
				nextOffset: size + extra,
			},
			{
				type: "exit",
				status: "exited",
				exitCode: 0,
				signal: null,
				stdoutOffset: size,
				stderrOffset: size + extra,
			},
		];
		const result = f.run(
			executeFixture({
				attach: (opts) => observeAttach(opts, frames),
				status: (opts) =>
					observeJson(opts, {
						...statusReceipt(),
						stdout: frames[1].data,
						stderr: frames[2].data,
					}),
			}),
		);
		if (extra) await assert.rejects(result, /completion is uncertain/);
		else assert.equal((await result).status, 0);
		const meta = phaseMetadata(f, "attach");
		assert.equal(meta.overflow, extra === 1);
		assert.equal(meta.complete, extra === 0);
		assert.equal(meta.streams["decoded-stdout"].observedBytes, size);
		assert.equal(meta.streams["decoded-stderr"].observedBytes, size + extra);
		assert.equal(
			fs.statSync(path.join(f.directory, "attach.decoded-stdout")).size,
			size,
		);
		assert.equal(
			fs.statSync(path.join(f.directory, "attach.decoded-stderr")).size,
			size,
		);
		assert.equal(provenOwnedSourceExit(f.records.at(-1)), extra === 0);
	});
}

test("synthetic closure shares the exact decoded budget between remote output and CLI stderr", async (t) => {
	for (const localFirst of [true, false]) {
		for (const extra of [0, 1]) {
			await t.test(
				`CLI stderr ${localFirst ? "first" : "last"}, limit ${extra ? "+ 1" : "exact"}`,
				async (t) => {
					const f = fixture(t);
					const remoteSize = 3 * 1024 * 1024;
					const localSize = 2 * 1024 * 1024;
					const remoteOut = "s".repeat(remoteSize);
					const remoteErr = "e".repeat(remoteSize + (localFirst ? extra : 0));
					const local = "l".repeat(localSize + (localFirst ? 0 : extra));
					const frames = [
						attachFrames()[0],
						{ type: "stdout", data: remoteOut, nextOffset: remoteOut.length },
						{ type: "stderr", data: remoteErr, nextOffset: remoteErr.length },
						{
							...attachFrames().at(-1),
							stdoutOffset: remoteOut.length,
							stderrOffset: remoteErr.length,
						},
					];
					const result = f.run(
						executeFixture({
							attach: (opts) => {
								assert.equal(
									opts.sourceObservation.raw("stderr", Buffer.from(local)),
									true,
								);
								if (localFirst)
									assert.equal(opts.sourceObservation.localStderr(local), true);
								const attached = observeAttach(opts, frames, null);
								if (!localFirst)
									assert.equal(
										opts.sourceObservation.localStderr(local),
										extra === 0,
									);
								opts.sourceObservation.close({ code: 0, signal: null });
								return attached;
							},
							status: (opts) =>
								observeJson(opts, {
									...statusReceipt(),
									stdout: remoteOut,
									stderr: remoteErr,
								}),
						}),
					);
					if (extra) await assert.rejects(result, /completion is uncertain/);
					else assert.equal((await result).output, remoteOut + remoteErr);
					const meta = phaseMetadata(f, "attach");
					assert.equal(meta.overflow, extra === 1);
					assert.equal(meta.complete, extra === 0);
					assert.equal(provenOwnedSourceExit(f.records.at(-1)), extra === 0);
					for (const [stream, retained, observedBytes] of [
						["stderr", local, local.length],
						["decoded-stdout", remoteOut, remoteOut.length],
						["decoded-stderr", "e".repeat(remoteSize), remoteErr.length],
						["decoded-cli-stderr", "l".repeat(localSize), local.length],
					]) {
						assert.equal(
							fs.readFileSync(path.join(f.directory, `attach.${stream}`), "utf8"),
							retained,
							stream,
						);
						assert.deepEqual(meta.streams[stream], {
							bytes: retained.length,
							observedBytes,
							sha256: createHash("sha256").update(retained).digest("hex"),
						});
					}
				},
			);
		}
	}
});

test("synthetic closure reports CLI stderr failures without authorizing completion", async (t) => {
	// These closures report failures; strict UTF-8 decoding belongs to the executor.
	for (const reason of ["invalid_utf8", "callback_failed"]) {
		await t.test(reason, async (t) => {
			const f = fixture(t);
			await assert.rejects(
				f.run(
					executeFixture({
						attach: (opts) => {
							opts.sourceObservation.localStderrFailure(reason);
							return observeAttach(opts);
						},
					}),
				),
				/completion is uncertain/,
			);
			const meta = phaseMetadata(f, "attach");
			assert.equal(meta.localStderrError, reason);
			assert.equal(meta.closed, true);
			assert.equal(meta.overflow, false);
			assert.equal(meta.complete, false);
			assert.deepEqual(meta.localExit, { code: 0, signal: null });
			assert.deepEqual(f.records.at(-1).terminal, attachFrames().at(-1));
			assert.equal(f.records.at(-1).protocolError, true);
			assert.equal(provenOwnedSourceExit(f.records.at(-1)), false);
		});
	}
});

test("a matching nonzero terminal and local attach close prove a completed failed generator", async (t) => {
	const f = fixture(t);
	const result = await f.run(
		executeFixture({
			attach: (opts) => observeAttach(opts, attachFrames(23)),
			status: (opts) => observeJson(opts, statusReceipt(23)),
		}),
	);
	assert.equal(result.status, 23);
	assert.equal(provenOwnedSourceExit(f.records.at(-1)), true);
	assert.deepEqual(phaseMetadata(f, "attach").localExit, {
		code: 23,
		signal: null,
	});
});

for (const [label, close, expected] of [
	[
		"unrelated nonzero exit",
		{ code: 71, signal: null },
		{ code: 71, signal: null },
	],
	[
		"signal",
		{ code: null, signal: "SIGTERM" },
		{ code: null, signal: "SIGTERM" },
	],
	[
		"spawn error",
		{ code: null, signal: null, error: { code: "ENOENT" } },
		{ code: null, signal: null, error: "ENOENT" },
	],
]) {
	test(`actual ${label} is retained even when the adapter result claims success`, async (t) => {
		const f = fixture(t);
		await assert.rejects(
			f.run(
				executeFixture({
					attach: (opts) => ({
						...observeAttach(opts, attachFrames(), close),
						status: 0,
					}),
				}),
			),
			/completion is uncertain/,
		);
		assert.deepEqual(phaseMetadata(f, "attach").localExit, expected);
		assert.equal(f.records.at(-1).protocolError, true);
		assert.equal(provenOwnedSourceExit(f.records.at(-1)), false);
	});
}

for (const phase of ["start", "attach", "status"]) {
	test(`a successful-looking ${phase} result without an observed close remains uncertain`, async (t) => {
		const f = fixture(t);
		await assert.rejects(
			f.run(
				executeFixture({
					[phase]: (opts) =>
						phase === "attach"
							? observeAttach(opts, attachFrames(), null)
							: observeJson(
									opts,
									phase === "start" ? startReceipt() : statusReceipt(),
									null,
								),
				}),
			),
			/completion is uncertain/,
		);
		const meta = phaseMetadata(f, phase);
		assert.equal(meta.closed, false);
		assert.equal(meta.complete, false);
		assert.equal(Object.hasOwn(meta, "localExit"), false);
		assert.equal(provenOwnedSourceExit(f.records.at(-1)), false);
	});
}

test("status must identify the exact returned command and original start time", async (t) => {
	for (const patch of [
		{ processId: 43 },
		{ command: "other command" },
		{ startedAt: "2026-11-01T12:00:00.001Z" },
	]) {
		await t.test(JSON.stringify(patch), async (t) => {
			const f = fixture(t);
			await assert.rejects(
				f.run(
					executeFixture({
						status: (opts) =>
							observeJson(opts, {
								...statusReceipt(),
								...patch,
							}),
					}),
				),
				/completion is uncertain/,
			);
			assert.equal(provenOwnedSourceExit(f.records.at(-1)), false);
		});
	}
});

test("the pure completion proof rejects missing facts and conflicting terminal identities", async (t) => {
	const f = fixture(t);
	await f.run(executeFixture());
	const complete = f.records.at(-1);
	assert.equal(provenOwnedSourceExit(complete), true);
	for (const field of [
		"start",
		"attached",
		"terminal",
		"status",
		"offsets",
		"phases",
	]) {
		const record = structuredClone(complete);
		delete record[field];
		assert.equal(provenOwnedSourceExit(record), false, `missing ${field}`);
	}
	const missingOffsets = structuredClone(complete);
	missingOffsets.offsets = {};
	delete missingOffsets.terminal.stdoutOffset;
	delete missingOffsets.terminal.stderrOffset;
	assert.equal(
		provenOwnedSourceExit(missingOffsets),
		false,
		"missing offset values do not prove output completion",
	);
	for (const patch of [
		{ processId: 43 },
		{ signal: "SIGTERM" },
		{ status: "running" },
		{ exitCode: null },
		{ exitCode: -1 },
		{ exitCode: 256 },
		{ stdoutOffset: offsets.stdoutOffset + 1 },
	]) {
		const record = structuredClone(complete);
		Object.assign(record.terminal, patch);
		assert.equal(provenOwnedSourceExit(record), false, JSON.stringify(patch));
	}
	for (const patch of [
		{ known: false },
		{ running: true },
		{ oomKilled: true },
		{ finishedAt: null },
		{ signal: "SIGKILL" },
		{ exitCode: 23 },
		{ finishedAt: "2026-11-01T11:59:59.000Z" },
	]) {
		const record = structuredClone(complete);
		Object.assign(record.status, patch);
		assert.equal(provenOwnedSourceExit(record), false, JSON.stringify(patch));
	}
});

function executeFixture(override = {}) {
	return async (cli, argv, opts) => {
		assert.equal(path.basename(cli), "synthetic-boat");
		const phase = argv.includes("--detach")
			? "start"
			: argv.includes("--attach")
				? "attach"
				: argv.includes("--status")
					? "status"
					: null;
		assert.ok(phase, `unexpected source command: ${argv.join(" ")}`);
		if (override[phase]) return override[phase](opts, argv);
		if (phase === "start") return observeJson(opts, startReceipt());
		if (phase === "status") return observeJson(opts, statusReceipt());
		return observeAttach(opts);
	};
}
