import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {RecentCreations} from '@/components/upload/recent-creations';
import {recentCreations} from '@/features/wallpaper-creation/adapters/http';
import {resumeWallpaperWithDetails} from '@/lib/api/wallpaper';
const session = vi.hoisted(() => ({ userId: 'creator' }));
vi.mock('@clerk/react',()=>({useAuth:()=>({userId:session.userId,isSignedIn:true})}));
vi.mock('@/features/wallpaper-creation/adapters/http',()=>({recentCreations:vi.fn(),downloadOriginal:vi.fn()}));
vi.mock('@/lib/api/wallpaper',()=>({resumeWallpaperWithDetails:vi.fn()}));
afterEach(()=>cleanup());
it('offers a saved pending creation after remount and resumes its identity with the reselected file',async()=>{
 const receipt={wallpaperId:'saved-wallpaper',state:'creating-asset' as const,assetId:null,sourceId:null,createdAt:'2026-10-22T00:00:00Z'};
 vi.mocked(recentCreations).mockResolvedValue([receipt]);
 vi.mocked(resumeWallpaperWithDetails).mockResolvedValue({success:false,pending:true,isDuplicate:false,response:{wallpaperId:receipt.wallpaperId,uploadState:'creating-asset'}});
 const firstClient=new QueryClient();const first=render(<QueryClientProvider client={firstClient}><RecentCreations/></QueryClientProvider>);
 await screen.findByText(receipt.wallpaperId);first.unmount();firstClient.clear();
 const client=new QueryClient();render(<QueryClientProvider client={client}><RecentCreations/></QueryClientProvider>);
 const input=await screen.findByLabelText('Resume this creation with its image');
 const file=new File(['image'],'retained.jpg',{type:'image/jpeg'});
 await userEvent.setup().upload(input,file);
 await waitFor(()=>expect(resumeWallpaperWithDetails).toHaveBeenCalledWith(file,'saved-wallpaper',expect.any(AbortSignal)));
 expect(screen.getByText(receipt.wallpaperId)).toBeInTheDocument();client.clear();
});


it.each(["navigation", "session"])(
	"aborts pending list polling on %s abandonment",
	async (reason) => {
		session.userId = "creator";
		const signals: AbortSignal[] = [];
		vi.mocked(recentCreations).mockImplementation((signal) => {
			if (!signal)
				throw new Error("List request must receive its query lifetime");
			signals.push(signal);
			return new Promise(() => {});
		});
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const tree = () => (
			<QueryClientProvider client={client}>
				<RecentCreations />
			</QueryClientProvider>
		);
		const view = render(tree());
		try {
			await waitFor(() => expect(signals).toHaveLength(1));
			expect(signals[0]?.aborted).toBe(false);
			if (reason === "navigation") view.unmount();
			else {
				session.userId = "next-creator";
				view.rerender(tree());
			}
			await waitFor(() => expect(signals[0]?.aborted).toBe(true));
		} finally {
			view.unmount();
			client.clear();
			session.userId = "creator";
		}
	},
);
