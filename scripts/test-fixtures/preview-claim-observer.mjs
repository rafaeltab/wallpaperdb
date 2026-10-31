// Fixture-only observation of one real generation-progress rename. The caller
// can publish atomic foreign input at that boundary without pausing production.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = process.env.FAKE_SOURCE;
const control = process.env.FAKE_CONTROL;
if (
	root &&
	control &&
	process.cwd() === root &&
	process.argv[1] === path.join(root, "scripts/boat.mjs") &&
	process.argv[2] === "preview"
) {
	const planFile = path.join(control, "immutable-claim-plan.json");
	const read = fs.readFileSync.bind(fs);
	const write = fs.writeFileSync.bind(fs);
	const rename = fs.renameSync.bind(fs);
	const plan = JSON.parse(read(planFile, "utf8"));
	const claimFile = path.join(root, ".boat/preview-acquisition.json");
	const snapshot = () => {
		const bytes = read(claimFile);
		return {
			claim: JSON.parse(bytes),
			sha256: createHash("sha256").update(bytes).digest("hex"),
			inode: fs.statSync(claimFile).ino,
		};
	};
	let observed = false,
		observation;
	const counts = { claimCreates: 0, claimWrites: 0, claimRenames: 0 };
	const report = () => {
		if (observation)
			write(
				path.join(control, "immutable-claim-observation.json"),
				JSON.stringify({ ...observation, counts }),
				{ mode: 0o600 },
			);
	};
	fs.writeFileSync = (name, bytes, ...args) => {
		if (name === claimFile) {
			if (args[0]?.flag === "wx") counts.claimCreates++;
			else counts.claimWrites++;
		}
		const result = write(name, bytes, ...args);
		report();
		return result;
	};
	process.once("exit", report);
	fs.renameSync = (from, to) => {
		if (to === claimFile) {
			counts.claimRenames++;
			const result = rename(from, to);
			report();
			return result;
		}
		if (
			observed ||
			path.dirname(to) !== path.join(root, ".boat") ||
			!/^preview-progress-[0-9a-f-]+\.json$/.test(path.basename(to))
		)
			return rename(from, to);
		const progress = JSON.parse(read(from, "utf8"));
		if (!progress.forward) return rename(from, to);
		const before = snapshot();
		if (
			progress.pid !== process.pid ||
			progress.generation !== before.claim.generation ||
			path.basename(to) !== before.claim.progress
		)
			throw Error("invalid fixture progress ownership");
		observed = true;
		let replacement;
		if (plan.replace) {
			const temporary = `${claimFile}.fixture-${process.pid}`;
			write(
				temporary,
				JSON.stringify({
					...before.claim,
					generation: "replacement-acquisition",
				}),
				{ mode: 0o600 },
			);
			rename(temporary, claimFile);
			replacement = snapshot();
		}
		// This is the actual production progress rename with unchanged arguments.
		const result = rename(from, to);
		const after = snapshot();
		observation = {
			before,
			replacement,
			after,
			progress,
			point: "generation progress rename",
			plan,
		};
		report();
		if (plan.denyForwardIdentity) {
			// Explicitly unavailable inspection is a fixture fault, not a claim that
			// this host denied inspection. Only the recorded owned PID is affected.
			fs.readFileSync = (name, ...args) => {
				if (name === `/proc/${progress.forward.pid}/stat`)
					throw Object.assign(
						new Error("fixture forward identity inspection unavailable"),
						{ code: "EACCES" },
					);
				return read(name, ...args);
			};
		}
		return result;
	};
}
