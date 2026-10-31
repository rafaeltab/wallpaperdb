import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { RecentCreations } from "@/components/upload/recent-creations";
import { recentCreations } from "@/features/wallpaper-creation/adapters/http";
import { resumeWallpaperWithDetails } from "@/lib/api/wallpaper";
const auth = vi.hoisted(() => ({ userId: "creator", isSignedIn: true }));
vi.mock("@clerk/react", () => ({ useAuth: () => auth }));
vi.mock("@/features/wallpaper-creation/adapters/http", () => ({
	recentCreations: vi.fn(),
	downloadOriginal: vi.fn(),
}));
vi.mock("@/lib/api/wallpaper", () => ({ resumeWallpaperWithDetails: vi.fn() }));
afterEach(() => cleanup());
it("cancels pending list requests when the session changes and when the UI unmounts", async () => {
	const signals: AbortSignal[] = [];
	vi.mocked(recentCreations).mockImplementation((signal) => {
    if (!signal) throw new Error('The UI must supply its request cancellation signal');
		signals.push(signal);
		return new Promise(() => {});
	});
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const ui = () => (
		<QueryClientProvider client={client}>
			<RecentCreations />
		</QueryClientProvider>
	);
	const view = render(ui());
	try {
		await waitFor(() => expect(signals).toHaveLength(1));
		expect(signals[0]?.aborted).toBe(false);
		auth.userId = "replacement";
		view.rerender(ui());
		await waitFor(() => expect(signals).toHaveLength(2));
		expect(signals[0]?.aborted).toBe(true);
		expect(signals[1]?.aborted).toBe(false);
		view.unmount();
		expect(signals[1]?.aborted).toBe(true);
	} finally {
		auth.userId = "creator";
		view.unmount();
		client.clear();
	}
});
it("offers a saved pending creation after remount and resumes its identity with the reselected file", async () => {
	const receipt = {
		wallpaperId: "saved-wallpaper",
		state: "creating-asset" as const,
		assetId: null,
		sourceId: null,
		createdAt: "2026-10-22T00:00:00Z",
	};
	vi.mocked(recentCreations).mockResolvedValue([receipt]);
	vi.mocked(resumeWallpaperWithDetails).mockResolvedValue({
		success: false,
		pending: true,
		isDuplicate: false,
		response: {
			wallpaperId: receipt.wallpaperId,
			uploadState: "creating-asset",
		},
	});
	const firstClient = new QueryClient();
	const first = render(
		<QueryClientProvider client={firstClient}>
			<RecentCreations />
		</QueryClientProvider>,
	);
	await screen.findByText(receipt.wallpaperId);
	first.unmount();
	firstClient.clear();
	const client = new QueryClient();
	render(
		<QueryClientProvider client={client}>
			<RecentCreations />
		</QueryClientProvider>,
	);
	const input = await screen.findByLabelText(
		"Resume this creation with its image",
	);
	const file = new File(["image"], "retained.jpg", { type: "image/jpeg" });
	await userEvent.setup().upload(input, file);
	await waitFor(() =>
		expect(resumeWallpaperWithDetails).toHaveBeenCalledWith(
			file,
			"saved-wallpaper",
			expect.any(AbortSignal),
		),
	);
	expect(screen.getByText(receipt.wallpaperId)).toBeInTheDocument();
	client.clear();
});
