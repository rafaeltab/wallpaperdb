import pino from "pino";

export function createTestLogger(name: string) {
	return pino({
		name,
		level: process.env.LOG_LEVEL ?? "silent",
	});
}
