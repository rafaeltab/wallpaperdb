export interface Artifact {
	path: string;
	sha256: string;
}
export interface Comparison {
	head: string;
	baseRef: string;
	baseSha: string;
	mergeBase: string;
}
export interface Applicability extends Partial<Comparison> {
	reviewedHead?: string;
	assessor?: string;
	rationale?: string;
	artifacts?: Artifact[];
}
export interface Review extends Partial<Comparison> {
	axis: string;
	reviewer?: string;
	task?: string;
	diffCommand?: string;
	requirements?: string;
	scope?: string;
	outcome?: string;
	findings?: { disposition?: string; url?: string }[];
	artifacts?: Artifact[];
	applicability?: Applicability;
}
export interface ReviewLedger {
	automationIncidents?: {
		url: string;
		userNotified: boolean;
		outcome: string;
	}[];
	current?: Comparison;
	reviews?: Review[];
	pendingScopeDecisions?: unknown[];
}
export interface Check {
	name?: string;
	context?: string;
	status?: string;
	conclusion?: string;
	state?: string;
	detailsUrl?: string;
	advisory?: boolean;
}
export interface PullRequest {
	url: string;
	number: number;
	state: string;
	isDraft: boolean;
	mergeable: string;
	headRefOid: string;
	headRefName: string;
	baseRefName: string;
	headRepository?: { name: string };
	headRepositoryOwner?: { login: string };
	statusCheckRollup?: Check[];
}
export interface Blocker {
	url?: string;
	state: string;
}
export interface Issue {
	url: string;
	state: string;
	assignees?: { login: string }[];
	blockedBy: { nodes: Blocker[]; totalCount?: number };
	project?: { owner: string; number: number; status?: string } | null;
}
export interface Workflow {
	path: string;
	sha?: string;
	content?: string;
}
export interface Exclusion {
	name: string;
	policyPath: string;
	rationale?: string;
}
export interface CiAssessment {
	policySha?: string;
	head?: string;
	baseRef?: string;
	rationale?: string;
	expectedChecks?: string[];
	noCiReason?: string;
	mergeSha?: string;
	inapplicableChecks?: Exclusion[];
}
export interface ValidationRecord {
	head: string;
	tree?: string;
	sourceDigest?: string;
	state?: string;
	expect?: string;
	expectationMet?: boolean;
	stable?: boolean;
	checks?: {
		command?: string[];
		exitCode?: number | null;
		signal?: string | null;
		error?: string | null;
		artifact?: Artifact;
	}[];
}
export interface Generator {
	script: string;
	outputs: string[];
	committed?: boolean;
}
export type Generators = Record<string, Record<string, Generator>>;
