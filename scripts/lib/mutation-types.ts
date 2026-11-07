export interface Position {
	line: number;
	column: number;
}
export interface Mutant {
	id: string;
	mutatorName: string;
	replacement?: string;
	location: { start: Position; end: Position };
	status: string;
	statusReason?: string;
	coveredBy?: string[];
	killedBy?: string[];
	conflictingStatuses?: string[];
	testsCompleted?: number;
	static?: boolean;
}
export interface TestResult {
	id: string;
	name: string;
	location?: { start: Position; end?: Position };
}
export interface MutationFile {
	source: string;
	mutants: Mutant[];
}
export interface TestFile {
	source: string;
	tests: TestResult[];
}
export interface MutationReport {
	schemaVersion: string;
	files: Record<string, MutationFile>;
	testFiles: Record<string, TestFile>;
	config?: unknown;
	projectRoot?: string;
}
export interface SuiteConfig {
	externalInputs?: string[];
	sourceFiles?: string[];
	environmentKeys?: string[];
	sourceRoots?: string[];
	vitest?: { configFile?: string; [key: string]: unknown };
	timeoutMS?: number;
	fixture?: string;
	fixtureImage?: string;
	[key: string]: unknown;
}
export interface Discovery {
	files: string[];
	selected: string[];
	total?: number | null;
}
export interface Baseline {
	version: number;
	key: string;
	inputDigest: string;
	createdAt: string;
	report: MutationReport;
	discovery?: Discovery;
	provenance?: Record<string, string | undefined>;
	compatibility: Record<string, unknown>;
	complete?: boolean;
}
