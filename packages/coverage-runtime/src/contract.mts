import type { FileCoverageData, Range } from "istanbul-lib-coverage";
export type Report = Record<string, FileCoverageData>;
export type SourceIdentities = Record<string, string>;
export interface TierIdentity {
	id: string;
	workspace: string;
	coverage: boolean;
}
export interface Tier extends TierIdentity {
	runtime: string;
	script: string;
	config: string;
	args: string[];
	strategy: "compiled-native" | "source-vite";
	containers: boolean;
}
export interface EstimatePolicy {
	sourceSHA256: string;
	branch: number[];
	body: number[];
	following: number[];
	finalReturn?: number[];
}
export type AuditPolicy = Record<string, EstimatePolicy>;
export interface Estimate {
	trueBody: number;
	following: number | null;
	difference: number | null;
	bodyStatement?: number | null;
	sourceSHA256?: string;
	finalReturn?: number | null;
	reason?: string;
}
export interface AuditEntry {
	report: string;
	file: string;
	branch: string;
	arm: number;
	location: Range;
	raw: number;
	published: number;
	classification: string;
	estimate: Estimate;
	policy: string;
}
export interface ReportInput {
	id: string;
	data: Report;
}
export interface GeneratedSource {
	source: string;
	sha256: string;
	coverage: FileCoverageData;
}
export type GeneratedSources = Record<string, GeneratedSource>;
export interface Receipt {
	identity: string;
	id: string;
	revision: string;
	coverage: boolean;
	passed: boolean;
	workspace: string;
	sourceHashes: SourceIdentities;
	raw: Report | null;
	data: Report | null;
	audit: AuditEntry[];
	generated: Record<
		string,
		Omit<GeneratedSource, "source"> & { sourceBase64: string }
	>;
	reportHash: string;
	rawHash: string;
}
export interface AttemptDetails {
	config: string;
	sourceConfig: string;
	id: string;
	mode: string;
	strategy: string;
}

export interface Generation {
	attempt: string;
	status: "running" | "success" | "failed";
	workspaces: string[];
	outputs: {
		id: string;
		workspace: string;
		path: string;
		sha256: string;
		rawReport: string;
	}[];
	sourceHashes: SourceIdentities;
	audit: AuditEntry[];
	scope: string;
}
