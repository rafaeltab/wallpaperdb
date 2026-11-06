import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function checkMigrations(directory) {
	const errors = [];
	const journal = JSON.parse(
		fs.readFileSync(path.join(directory, "meta/_journal.json"), "utf8"),
	);
	const expected = new Set();
	const ids = new Set();
	let previous = "00000000-0000-0000-0000-000000000000";
	let timestamp = -Infinity;
	for (const [index, entry] of journal.entries.entries()) {
		if (entry.idx !== index)
			errors.push(`${directory}: journal index ${entry.idx} must be ${index}`);
		if (!/^\d{4}_[\w-]+$/.test(entry.tag)) {
			errors.push(`${directory}: invalid migration tag`);
			continue;
		}
		if (entry.when <= timestamp)
			errors.push(`${directory}: migration timestamps must increase`);
		timestamp = entry.when;
		const sql = `${entry.tag}.sql`;
		expected.add(sql);
		if (!fs.existsSync(path.join(directory, sql)))
			errors.push(`${directory}: missing SQL ${sql}`);
		const file = path.join(
			directory,
			"meta",
			`${String(entry.idx).padStart(4, "0")}_snapshot.json`,
		);
		if (!fs.existsSync(file)) {
			errors.push(`${directory}: missing snapshot ${entry.idx}`);
			continue;
		}
		const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
		if (!snapshot.id || ids.has(snapshot.id) || snapshot.prevId !== previous)
			errors.push(`${file}: broken snapshot identity chain`);
		ids.add(snapshot.id);
		previous = snapshot.id;
	}
	for (const file of fs.readdirSync(directory))
		if (file.endsWith(".sql") && !expected.has(file))
			errors.push(`${directory}: SQL ${file} is absent from the journal`);
	return errors;
}
export function checkSchemaColumns(snapshot, actual) {
	const errors = [];
	const observed = new Map(
		actual.map((column) => [
			`${column.schema}.${column.table}.${column.column}`,
			column.notNull,
		]),
	);
	for (const table of Object.values(snapshot.tables))
		for (const column of Object.values(table.columns)) {
			const key = `${table.schema || "public"}.${table.name}.${column.name}`;
			if (!observed.has(key)) errors.push(`Missing replayed column ${key}`);
			else if (observed.get(key) !== column.notNull)
				errors.push(`Replayed nullability differs for ${key}`);
			observed.delete(key);
		}
	for (const key of observed.keys())
		errors.push(`Unexpected replayed column ${key}`);
	return errors;
}
export function checkSchemaDump(expected, actual) {
	// PostgreSQL's random psql safety token is the only volatile dump content.
	const normalize = (dump) =>
		dump.replace(/^\\(?:un)?restrict .*\r?\n/gm, "").trim();
	const wanted = normalize(expected).split("\n");
	const found = normalize(actual).split("\n");
	const line = Array.from(
		{ length: Math.max(wanted.length, found.length) },
		(_, index) => index,
	).find((index) => wanted[index] !== found[index]);
	return line === undefined
		? []
		: [
				`schema differs from snapshot at dump line ${line + 1}: expected ${wanted[line] ?? "<end>"}; actual ${found[line] ?? "<end>"}`,
			];
}
if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const root = fileURLToPath(new URL("../", import.meta.url));
	const errors = [];
	const definitions = JSON.parse(
		fs.readFileSync(path.join(root, "generated.config.json"), "utf8"),
	).migrations;
	for (const [workspace, { outputs }] of Object.entries(definitions)) {
		const config = fs.readFileSync(
			path.join(root, workspace, "drizzle.config.ts"),
			"utf8",
		);
		const out = config
			.match(/\bout:\s*['"]([^'"]+)['"]/)?.[1]
			?.replace(/^\.\//, "");
		if (!out || outputs.length !== 1 || outputs[0] !== out)
			errors.push(
				`${workspace}: migration outputs must match drizzle.config.ts`,
			);
		else errors.push(...checkMigrations(path.join(root, workspace, out)));
	}
	if (errors.length) {
		console.error(errors.join("\n"));
		process.exitCode = 1;
	} else
		console.log(
			"Migration journals, SQL and snapshot identity chains verified.",
		);
}
