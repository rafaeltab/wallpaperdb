import { afterEach, expect, it, vi } from "vitest";
import { recentCreations } from "@/features/wallpaper-creation/adapters/http";
vi.mock("@/lib/auth/token-provider", () => ({
	getAuthToken: async () => "owner-token",
}));
afterEach(() => vi.unstubAllGlobals());
it("reads the saved candidate rejection after loading durable Wallpaper progress again", async () => {
	const requests: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, options: RequestInit) => {
			requests.push(url);
			expect(new Headers(options.headers).get("Authorization")).toBe(
				"Bearer owner-token",
			);
			const data =
				requests.length === 1
					? {
							wallpapers: [
								{
									wallpaperId: "wallpaper",
									state: "accepting-source",
									assetId: "asset",
									sourceId: null,
									candidateId: "candidate",
									createdAt: "2026-10-22T00:00:00Z",
								},
							],
						}
					: { candidateId: "candidate", status: "rejected" };
			return new Response(JSON.stringify(data), {
				headers: { "Content-Type": "application/json" },
			});
		}),
	);
	expect(await recentCreations()).toEqual([
		{
			wallpaperId: "wallpaper",
			state: "accepting-source",
			assetId: "asset",
			sourceId: null,
			candidateId: "candidate",
			createdAt: "2026-10-22T00:00:00Z",
			candidateStatus: "rejected",
		},
	]);
	expect(requests).toEqual([
		"/wallpaper/wallpapers",
		"/asset/assets/asset/source-candidates/candidate",
	]);
});
it("sends the captured current revision and independent correlation for an additional Source", async () => {
	const { browserSourceBatchApi } = await import(
		"@/features/wallpaper-creation/adapters/http"
	);
	const requests: { url: string; options: RequestInit }[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, options: RequestInit) => {
			requests.push({ url, options });
			return new Response(
				JSON.stringify({
					operation: "add",
					candidateId: "candidate-2",
					status: "accepted",
					expectedSourceSetRevision: "1",
					sourceId: "source-2",
				}),
				{ headers: { "Content-Type": "application/json" } },
			);
		}),
	);
	expect(
		await browserSourceBatchApi().accept(
			"asset",
			"candidate-2",
			"1",
			"independent",
			new AbortController().signal,
		),
	).toMatchObject({ status: "accepted", sourceId: "source-2" });
	expect(requests[0]?.url).toBe(
		"/asset/assets/asset/source-candidates/candidate-2/accept",
	);
	expect(JSON.parse(String(requests[0]?.options.body))).toEqual({
		operation: "add",
		expectedSourceSetRevision: "1",
	});
	expect(
		new Headers(requests[0]?.options.headers).get("X-Correlation-Id"),
	).toBe("independent");
});
it("keeps candidate continuation opaque and preserves pending work outside the returned page", async () => {
	const { ownedSources } = await import(
		"@/features/wallpaper-creation/adapters/http"
	);
	const requests: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			requests.push(url);
			return new Response(
				JSON.stringify({
					sourceSetRevision: "1",
					defaultSourceId: null,
					sources: [],
					candidates: [],
					hasPendingCandidates: true,
					nextCandidateCursor: "12:candidate-before",
				}),
				{ headers: { "Content-Type": "application/json" } },
			);
		}),
	);
	expect(
		await ownedSources(
			"asset",
			new AbortController().signal,
			"44:candidate-after",
		),
	).toMatchObject({
		hasPendingCandidates: true,
		nextCandidateCursor: "12:candidate-before",
		candidates: [],
	});
	expect(requests).toEqual([
		"/asset/assets/asset/sources?candidateCursor=44%3Acandidate-after",
	]);
});

it("translates immutable replacement intent on create, accept and saved candidate discovery", async () => {
	const { browserSourceBatchApi, ownedSources } = await import(
		"@/features/wallpaper-creation/adapters/http"
	);
	const requests: { url: string; options: RequestInit }[] = [];
	const mutation = {
		operation: "replace-one" as const,
		targetSourceId: "source/old",
	};
	const candidate = {
		...mutation,
		candidateId: "candidate-replace",
		status: "ready",
		expectedSourceSetRevision: "9007199254740993",
	};
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, options: RequestInit) => {
			requests.push({ url, options });
			return new Response(
				JSON.stringify(
					url.endsWith("/sources")
						? {
								sourceSetRevision: "9007199254740993",
								defaultSourceId: null,
								sources: [],
								hasPendingCandidates: true,
								candidates: [candidate],
							}
						: candidate,
				),
				{ headers: { "Content-Type": "application/json" } },
			);
		}),
	);
	const api = browserSourceBatchApi(),
		signal = new AbortController().signal;
	expect(
		await api.create(
			"stable-asset",
			"replace-key",
			"9007199254740993",
			signal,
			mutation,
		),
	).toMatchObject(candidate);
	expect(
		await api.accept(
			"stable-asset",
			"candidate-replace",
			"9007199254740993",
			"replace-correlation",
			signal,
			mutation,
		),
	).toMatchObject(candidate);
	expect((await ownedSources("stable-asset", signal)).candidates).toEqual([
		candidate,
	]);
	for (const request of requests.slice(0, 2))
		expect(JSON.parse(String(request.options.body))).toEqual({
			...mutation,
			expectedSourceSetRevision: "9007199254740993",
		});
	expect(new Headers(requests[0]?.options.headers).get("Idempotency-Key")).toBe(
		"replace-key",
	);
});

it.each(["replacement-default", "first-publication"])(
	"downloads current Default %s while preserving the immutable Wallpaper receipt",
	async (sourceId) => {
		const { downloadOriginal } = await import(
			"@/features/wallpaper-creation/adapters/http"
		);
		const requests: string[] = [];
		vi.stubGlobal(
			"URL",
			Object.assign(class extends URL {}, {
				createObjectURL: () => "blob:current-original",
				revokeObjectURL: () => {},
			}),
		);
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => {});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				requests.push(url);
				return url.endsWith("/sources")
					? new Response(
							JSON.stringify({
								sourceSetRevision: "2",
								defaultSourceId: sourceId,
								sources: [{ sourceId, facts: { width: 100, height: 100 } }],
								candidates: [],
								hasPendingCandidates: false,
							}),
						)
					: new Response(new Uint8Array([1, 2, 3]));
			}),
		);
		try {
			await downloadOriginal(
				{
					wallpaperId: "unchanged",
					assetId: "stable",
					sourceId: "first-publication",
					state: "published",
					createdAt: "now",
				},
				new AbortController().signal,
			);
			expect(requests).toEqual([
				"/asset/assets/stable/sources",
				`/asset/assets/stable/sources/${sourceId}/original`,
			]);
			expect(click).toHaveBeenCalledOnce();
		} finally {
			click.mockRestore();
		}
	},
);

it("connects list fetch cancellation to the caller signal", async () => {
	const controller = new AbortController();
	let received: AbortSignal | null | undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn((_url: string, options: RequestInit) => {
			received = options.signal;
			return new Promise<Response>((_resolve, reject) => {
				options.signal?.addEventListener(
					"abort",
					() => reject(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			});
		}),
	);
	const result = recentCreations(controller.signal);
	const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
	await vi.waitFor(() => expect(received).toBe(controller.signal));
	controller.abort();
	await rejected;
});
