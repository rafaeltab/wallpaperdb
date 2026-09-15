import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { ProfileInlineField } from '@/components/profile/profile-inline-field';
import { userApi, UserApiError, type Profile } from '@/lib/api/user';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api/user', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/user')>();
  return { ...original, userApi: { ...original.userApi, updateProfile: vi.fn(), updateHandle: vi.fn(), ensureProfile: vi.fn() } };
});
const profile: Profile = {
  id: 'user_inline', handle: 'ada', displayName: 'Ada Lovelace', biographyMarkdown: 'Original biography', pictureAssetId: null,
  version: 1, createdAt: '2026-07-12T12:00:00.000Z', updatedAt: '2026-07-12T12:00:00.000Z',
};
const tokenProvider = vi.fn().mockResolvedValue('token');
function renderField(field: 'displayName' | 'handle' | 'biographyMarkdown' = 'displayName', initial = profile) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(profileQueryKey(initial.id), initial);
  function Owner() {
    const { data = initial } = useQuery({ queryKey: profileQueryKey(initial.id), queryFn: () => userApi.ensureProfile(), staleTime: Infinity });
    return <ProfileInlineField field={field} profile={data} tokenProvider={tokenProvider} />;
  }
  return { client, ...render(<QueryClientProvider client={client}><Owner /><button type="button">Other action</button></QueryClientProvider>) };
}
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(1); }); }
describe('production inline profile fields', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.mocked(userApi.updateProfile).mockReset(); vi.mocked(userApi.updateHandle).mockReset(); vi.mocked(userApi.ensureProfile).mockReset(); });
  afterEach(() => vi.useRealTimers());
  it('waits for the actual save, commits the complete owner response, then finishes its success feedback', async () => {
    let resolve: ((value: Profile) => void) | undefined;
    vi.mocked(userApi.updateProfile).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { client } = renderField();
    fireEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    const input = screen.getByRole('textbox', { name: 'Display name' });
    fireEvent.change(input, { target: { value: '  Ada   Byron  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save display name' }));
    await flush();
    expect(screen.getByRole('button', { name: 'Saving display name' })).toBeDisabled();
    expect(input).toBeDisabled();
    expect(userApi.updateProfile).toHaveBeenCalledWith({ displayName: '  Ada   Byron  ', expectedVersion: 1, expectedProfileId: profile.id, tokenProvider });
    const updated = { ...profile, displayName: 'Ada Byron', version: 2, aliases: [{ handle: 'first', claimGeneration: 2 }] };
    await act(async () => resolve?.(updated));
    await flush();
    expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(updated);
    expect(screen.getByRole('button', { name: 'Display name saved' })).toBeDisabled();
    expect(toast.success).toHaveBeenCalledWith('Display name updated');
    expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveValue('Ada Byron');
    await act(async () => vi.advanceTimersByTimeAsync(1600));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ada Byron' })).toBeInTheDocument();
  });
  it('preserves the failed draft with error feedback, then accepts a retry', async () => {
    vi.mocked(userApi.updateProfile).mockRejectedValueOnce(new Error('Offline'));
    vi.mocked(userApi.updateProfile).mockResolvedValueOnce({ ...profile, displayName: 'Ada Byron', version: 2 });
    renderField();
    fireEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    const input = screen.getByRole('textbox', { name: 'Display name' });
    fireEvent.change(input, { target: { value: 'Ada Byron' } });
    fireEvent.submit(input.closest('form')!);
    await flush();
    expect(screen.getByRole('button', { name: 'Display name save failed' })).toBeDisabled();
    expect(input).toBeEnabled();
    expect(input).toHaveValue('Ada Byron');
    expect(toast.error).toHaveBeenCalledWith('Unable to save display name', { description: 'Offline' });
    await act(async () => vi.advanceTimersByTimeAsync(1600));
    fireEvent.click(screen.getByRole('button', { name: 'Save display name' }));
    await flush();
    expect(userApi.updateProfile).toHaveBeenCalledTimes(2);
  });

  it('keeps a dirty draft at its original version until an explicit conflict refresh rebases it', async () => {
    vi.mocked(userApi.updateProfile).mockRejectedValueOnce(new UserApiError('Changed elsewhere', 409, { type: 'https://example.test/profile-version-conflict' }));
    vi.mocked(userApi.ensureProfile).mockResolvedValue({ ...profile, displayName: 'Remote name', version: 3 });
    const { client } = renderField();
    fireEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    const input = screen.getByRole('textbox', { name: 'Display name' });
    fireEvent.change(input, { target: { value: 'My draft' } });
    act(() => { client.setQueryData(profileQueryKey(profile.id), { ...profile, displayName: 'Other name', version: 2 }); });
    await flush();
    expect(input).toHaveValue('My draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save display name' }));
    await flush();
    expect(userApi.updateProfile).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh profile' }));
    await flush();
    expect(input).toHaveValue('My draft');
    vi.mocked(userApi.updateProfile).mockResolvedValue({ ...profile, displayName: 'My draft', version: 4 });
    fireEvent.click(screen.getByRole('button', { name: 'Save display name' }));
    await flush();
    expect(userApi.updateProfile).toHaveBeenLastCalledWith(expect.objectContaining({ displayName: 'My draft', expectedVersion: 3 }));
  });

});
