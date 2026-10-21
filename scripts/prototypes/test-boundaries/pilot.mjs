// Reviewed responsibilities, not inferred from task names or test suffixes.
// Subjects reference the existing architecture entries. No capability names list.
export const pilot = [
	{
		workspace: "apps/gateway",
		kind: "backend",
		tests: [
			{
				file: "test/catalogue.unit.test.ts",
				role: "capability",
				subject: "src/capabilities/catalogue/index.ts",
				reason:
					"Search outcomes and pagination with stateful read/cursor ports.",
			},
			{
				file: "test/projection.unit.test.ts",
				role: "capability",
				subject: "src/capabilities/projection/index.ts",
				reason:
					"Projection decisions and observable transactional port writes.",
			},
			{
				file: "test/unit/admission.unit.test.ts",
				role: "capability",
				subject: "src/capabilities/admission/index.ts",
				reason: "Admission decisions with in-memory quota.",
			},
			{
				file: "test/unit/availability.unit.test.ts",
				role: "capability",
				subject: "src/capabilities/availability/index.ts",
				reason: "Availability decisions with controlled probes and time.",
			},
			{
				file: "test/opensearch.unit.test.ts",
				role: "driven-adapter",
				subject: "src/adapters/opensearch/index.ts",
				reason:
					"Controlled HTTP translation contracts, not proof of native server semantics.",
			},
			{
				file: "test/search/opensearch.integration.test.ts",
				role: "driven-adapter",
				subject: "src/adapters/opensearch/index.ts",
				reason: "Native OpenSearch port guarantees with a real container.",
			},
			{
				file: "test/redis.integration.test.ts",
				role: "driven-adapter",
				subject: "src/adapters/redis/index.ts",
				reason:
					"Redis quota guarantees; also contains a wider HTTP path, so file roles are coarse.",
			},
			{
				file: "test/unit/availability-adapter.unit.test.ts",
				role: "driven-adapter",
				subject: "src/adapters/availability/index.ts",
				reason: "Technical probe failure and timeout translation.",
			},
			{
				file: "test/http-lifecycle.unit.test.ts",
				role: "driving-adapter",
				subject: "src/http/index.ts",
				reason: "HTTP admission and scoped runtime lifetimes.",
			},
			{
				file: "test/unit/runtime.unit.test.ts",
				role: "composition",
				subject: "src/runtime.ts",
				reason:
					"Managed runtime wiring and interruption with controlled services.",
			},
		],
	},
	{
		workspace: "apps/web",
		kind: "frontend",
		tests: [
			{
				file: "test/features/authentication.test.ts",
				role: "frontend-workflow",
				subject: "src/features/authentication/index.ts",
				reason: "Public auth URL and next-action policy.",
			},
			{
				file: "test/features/auth-navigation.dom.test.tsx",
				role: "frontend-integration",
				subject: "src/features/authentication/adapters/navigation.ts",
				reason:
					"React navigation hook remains real; router dependency is mocked.",
			},
		],
	},
];
