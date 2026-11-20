// Preserve only the official V8 destination in deliberately clean child envs.
// Do not restore transformation options, dotenv settings or caller secrets.
export function coverageEnvironment(
	environment: NodeJS.ProcessEnv,
	parent = process.env,
) {
	return parent.NODE_V8_COVERAGE
		? { ...environment, NODE_V8_COVERAGE: parent.NODE_V8_COVERAGE }
		: environment;
}
