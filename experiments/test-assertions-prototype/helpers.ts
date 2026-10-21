import { expect, type ExpectStatic } from "vitest";

export function assertName(name: string, check: ExpectStatic = expect) {
	check(name).toBe("Ada");
}

export async function assertNameAsync(name: Promise<string>) {
	assertName(await name);
}

export function outcome():
	| { _tag: "Success"; name: string }
	| { _tag: "Rejected" } {
	return { _tag: "Success", name: "Ada" };
}
