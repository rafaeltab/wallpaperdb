import { createHash } from "node:crypto";

export const hash = (value) => createHash("sha256").update(value).digest("hex");

// Native ids are local to a Stryker invocation. Never join stages by those ids.
export function mutationId(name, source, mutant) {
	return hash(
		JSON.stringify([
			name,
			hash(source),
			mutant.mutatorName,
			mutant.replacement,
			[mutant.location.start.line, mutant.location.start.column],
			[mutant.location.end.line, mutant.location.end.column],
		]),
	);
}

export const isProcessed = (mutant) =>
	["Killed", "Survived", "NoCoverage", "Timeout", "CompileError"].includes(
		mutant?.status,
	);

/** Merge independent snapshots without confusing local test ids or sources. */
export function mergeReports(reports) {
	const result = { schemaVersion: "1.0", files: {}, testFiles: {} };
	const mutants = new Map();
	const testVersions = new Map();
	for (const report of reports) {
		const ids = new Map();
		for (const [name, file] of Object.entries(report.testFiles)) {
			if (!testVersions.has(name)) testVersions.set(name, new Map());
			const versions = testVersions.get(name);
			if (!versions.has(file.source))
				versions.set(file.source, { ...file, tests: [] });
			const metadata = versions.get(file.source);
			for (const test of file.tests) {
				const id = hash(
					JSON.stringify([name, file.source, test.name, test.location]),
				);
				ids.set(test.id, id);
				if (!metadata.tests.some((t) => t.id === id))
					metadata.tests.push({ ...test, id });
			}
		}
		for (const [name, file] of Object.entries(report.files)) {
			if (result.files[name]?.source !== file.source) {
				result.files[name] = { ...file, mutants: [] };
				mutants.set(name, new Map());
			}
			for (const mutant of file.mutants) {
				const id = mutationId(name, file.source, mutant);
				const previous = mutants.get(name).get(id);
				const outcomes = [
					...new Set(
						[previous, mutant].flatMap(
							(m) =>
								m?.conflictingStatuses ?? (isProcessed(m) ? [m.status] : []),
						),
					),
				].sort();
				if (outcomes.length > 1) {
					// Conflicting evidence stays visible across later partial snapshots.
					// RuntimeError prevents native reuse and cannot inflate the kill rate.
					mutants.get(name).set(id, {
						...mutant,
						id,
						status: "RuntimeError",
						statusReason: `Conflicting checkpoint outcomes: ${outcomes.join(", ")}`,
						conflictingStatuses: outcomes,
						coveredBy: mutant.coveredBy?.map((t) => ids.get(t) ?? t),
						killedBy: [],
					});
					continue;
				}
				// A partial writer cannot erase completed progress from another writer.
				if (!previous || isProcessed(mutant) || !isProcessed(previous))
					mutants.get(name).set(id, {
						...mutant,
						id,
						coveredBy: mutant.coveredBy?.map((t) => ids.get(t) ?? t),
						killedBy: mutant.killedBy?.map((t) => ids.get(t) ?? t),
					});
			}
		}
	}
	for (const [name, entries] of mutants)
		result.files[name].mutants = [...entries.values()];
	const retained = [...mutants.values()].flatMap((entries) => [
		...entries.values(),
	]);
	const terminalTests = new Set(
		retained
			.filter(isProcessed)
			.flatMap((mutant) => [
				...(mutant.coveredBy ?? []),
				...(mutant.killedBy ?? []),
			]),
	);
	for (const [name, versions] of testVersions) {
		const candidates = [...versions.values()];
		const evidence = candidates.filter((file) =>
			file.tests.some((test) => terminalTests.has(test.id)),
		);
		// A plan-only snapshot cannot replace metadata backing retained results.
		result.testFiles[name] = evidence.at(-1) ?? candidates.at(-1);
	}
	const availableTests = new Set(
		Object.values(result.testFiles).flatMap((file) =>
			file.tests.map((test) => test.id),
		),
	);
	for (const mutant of retained) {
		const references = [
			...(mutant.coveredBy ?? []),
			...(mutant.killedBy ?? []),
		];
		if (references.some((id) => !availableTests.has(id))) {
			if (isProcessed(mutant)) {
				mutant.status = "RuntimeError";
				mutant.statusReason =
					"Checkpoint test metadata is incompatible with retained evidence";
			}
			mutant.coveredBy = [];
			mutant.killedBy = [];
		}
	}
	return result;
}

export function resultIndex(report) {
	return new Map(
		Object.entries(report?.files ?? {}).flatMap(([name, file]) =>
			file.mutants.map((mutant) => [
				mutationId(name, file.source, mutant),
				{ ...mutant, file: name },
			]),
		),
	);
}

export function combineStages(
	unit,
	integration,
	applicable,
	hasUnit = Boolean(unit),
) {
	const units = resultIndex(unit),
		integrations = resultIndex(integration);
	const entries = new Map([...integrations, ...units]);
	return [...entries].map(([id, mutant]) => {
		const u = units.get(id),
			i = integrations.get(id);
		let status = u?.status ?? "Pending";
		if (!hasUnit || ["Survived", "NoCoverage"].includes(status)) {
			if (applicable(mutant.file)) {
				status = i?.status ?? "Pending";
				if (status === "Ignored") status = "Pending";
				if (status === "NoCoverage" && u?.status === "Survived")
					status = "Survived";
			} else if (!hasUnit) status = "Pending";
		}
		return {
			id,
			file: mutant.file,
			location: mutant.location,
			mutatorName: mutant.mutatorName,
			replacement: mutant.replacement,
			status,
			stages: {
				unit: u?.status ?? (unit ? "Pending" : "not-applicable"),
				integration:
					u?.status === "Killed"
						? "skipped-unit-kill"
						: applicable(mutant.file)
							? (i?.status ?? "Pending")
							: "not-applicable",
			},
		};
	});
}

export function resultCounts(mutants) {
	const counts = {};
	for (const mutant of mutants)
		counts[mutant.status] = (counts[mutant.status] ?? 0) + 1;
	const processed = mutants.filter(isProcessed).length;
	const scoreDenominator =
		(counts.Killed ?? 0) +
		(counts.Survived ?? 0) +
		(counts.NoCoverage ?? 0) +
		(counts.Timeout ?? 0) +
		(counts.CompileError ?? 0) +
		(counts.RuntimeError ?? 0);
	return {
		counts,
		total: mutants.length,
		processed,
		pending: mutants.length - processed,
		errors: (counts.RuntimeError ?? 0) + (counts.CompileError ?? 0),
		// Timeouts and invalid execution never increase the kill rate.
		mutationScore: scoreDenominator
			? (100 * (counts.Killed ?? 0)) / scoreDenominator
			: null,
	};
}
