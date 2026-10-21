import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
afterEach(() => vi.useRealTimers());

test("controlled time checks the exact debounce boundary", async () => {
	vi.useFakeTimers();
	let calls = 0;
	setTimeout(() => {
		calls++;
	}, 300);
	await vi.advanceTimersByTimeAsync(299);
	expect(calls).toBe(0);
	await vi.advanceTimersByTimeAsync(1);
	expect(calls).toBe(1);
});
test("observable bounded wait tolerates delayed completion", async () => {
	let ready = false;
	// stability-allow: fake-response models delayed application completion
	const timer = setTimeout(() => {
		ready = true;
	}, 30);
	try {
		await vi.waitFor(() => expect(ready).toBe(true), {
			timeout: 1000,
			interval: 5,
		});
	} finally {
		clearTimeout(timer);
	}
});
test("delayed fake response is intentional", async () => {
	vi.useFakeTimers();
	// stability-allow: fake-response models slow upstream
	const response = new Promise((resolve) =>
		setTimeout(() => resolve("response"), 50),
	);
	await vi.advanceTimersByTimeAsync(50);
	expect(await response).toBe("response");
});
test("deadline guard bounds a hung operation", async () => {
	let timer;
	// stability-allow: deadline-guard bounds operation completion
	const deadline = new Promise((resolve) => {
		timer = setTimeout(() => resolve("deadline"), 1000);
	});
	try {
		expect(await Promise.race([Promise.resolve("done"), deadline])).toBe(
			"done",
		);
	} finally {
		clearTimeout(timer);
	}
});
describe("owned serial shared fixture", { concurrent: false }, () => {
	let fixture;
	beforeAll(() => {
		fixture = { answer: 42 };
	});
	test("first reader uses declared setup", () => {
		expect(fixture.answer).toBe(42);
	});
	test("second reader uses declared setup", () => {
		expect(fixture.answer).toBe(42);
	});
});
