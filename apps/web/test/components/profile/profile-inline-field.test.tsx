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

  it('confirms aliases at capacity and submits the captured raw handle and version', async () => {
    const initial = { ...profile, retainedAliasLimit: 1, aliases: [{ handle: 'old', claimGeneration: 1 }] };
    vi.mocked(userApi.updateHandle).mockResolvedValue({ ...initial, handle: 'ada-byron', version: 2, lastHandleChangedAt: new Date().toISOString() });
    const { client } = renderField('handle', initial);
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    const input = screen.getByRole('textbox', { name: 'Profile handle' });
    fireEvent.change(input, { target: { value: 'Áda Byron!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile handle' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('@old');
    expect(userApi.updateHandle).not.toHaveBeenCalled();
    act(() => { client.setQueryData(profileQueryKey(profile.id), { ...initial, version: 8 }); });
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm handle change' }));
    await flush();
    expect(userApi.updateHandle).toHaveBeenCalledWith({ handle: 'Áda Byron!', expectedVersion: 1, expectedProfileId: profile.id, tokenProvider });
    await act(async () => vi.advanceTimersByTimeAsync(1600));
    expect(screen.getByRole('button', { name: 'Edit profile handle' })).toBeDisabled();
    expect(screen.getByText('7 days')).toBeInTheDocument();
  });

  it('edits biography with a safe preview, codepoint limit, and an empty valid save', async () => {
    vi.mocked(userApi.updateProfile).mockResolvedValue({ ...profile, biographyMarkdown: '', version: 2 });
    renderField('biographyMarkdown', { ...profile, biographyMaxLength: 10 });
    fireEvent.click(screen.getByRole('button', { name: 'Edit biography' }));
    const input = screen.getByRole('textbox', { name: 'Biography Markdown' });
    fireEvent.change(input, { target: { value: '😀'.repeat(11) } });
    expect(screen.getByText('11 / 10 characters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save biography' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '**Hello**' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('region', { name: 'Biography preview' })).toHaveTextContent('Hello');
    fireEvent.click(screen.getByRole('button', { name: 'Write' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '<script>x</script>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText('This Biography cannot be displayed safely.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Write' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save biography' }));
    await flush();
    expect(userApi.updateProfile).toHaveBeenCalledWith({ biographyMarkdown: '', expectedVersion: 1, expectedProfileId: profile.id, tokenProvider });
    await act(async () => vi.advanceTimersByTimeAsync(1600));
    expect(screen.getByText('No biography yet.')).toBeInTheDocument();
  });

  it('validates normalized display names by Unicode characters without truncating the raw input', async () => {
    renderField();
    fireEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    const input = screen.getByRole('textbox', { name: 'Display name' });
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save display name' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Display name must not be blank');
    fireEvent.change(input, { target: { value: '😀'.repeat(81) } });
    expect(screen.getByRole('button', { name: 'Save display name' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '😀'.repeat(80) + '    ' } });
    expect(input).toHaveValue('😀'.repeat(80) + '    ');
    expect(input).not.toHaveAttribute('maxlength');
    expect(screen.getByRole('button', { name: 'Save display name' })).toBeEnabled();
  });

  it.each([false, true])('handles a late save after navigation without a toast (owner removed: %s)', async (removed) => {
    let resolve: ((value: Profile) => void) | undefined;
    vi.mocked(userApi.updateProfile).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { client, unmount } = renderField();
    fireEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Saved late' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save display name' }));
    await flush();
    unmount();
    if (removed) client.removeQueries({ queryKey: profileQueryKey(profile.id) });
    const updated = { ...profile, displayName: 'Saved late', version: 2 };
    await act(async () => resolve?.(updated));
    await flush();
    expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(removed ? undefined : updated);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('returns focus to the handle availability tooltip after a successful change locks editing', async () => {
    vi.mocked(userApi.updateHandle).mockResolvedValue({ ...profile, handle: 'new-ada', version: 2, lastHandleChangedAt: new Date().toISOString() });
    renderField('handle');
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile handle' }));
    const input = screen.getByRole('textbox', { name: 'Profile handle' });
    fireEvent.change(input, { target: { value: 'new-ada' } });
    fireEvent.submit(input.closest('form')!);
    await flush();
    await act(async () => vi.advanceTimersByTimeAsync(1600));
    expect(screen.getByRole('button', { name: '7 days' })).toHaveFocus();
  });

  it('does not overwrite a new owner session with a response from before logout', async () => {
    let resolve: ((value: Profile) => void) | undefined;
    vi.mocked(userApi.updateProfile).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { client, unmount } = renderField();
    fireEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Old session edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save display name' }));
    await flush();
    unmount();
    client.removeQueries({ queryKey: profileQueryKey(profile.id) });
    const newSessionProfile = { ...profile, displayName: 'New session', version: 8 };
    client.setQueryData(profileQueryKey(profile.id), newSessionProfile);
    await act(async () => resolve?.({ ...profile, displayName: 'Old session edit', version: 2 }));
    await flush();
    expect(client.getQueryData(profileQueryKey(profile.id))).toEqual(newSessionProfile);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each([false, true])('uses the current clock when a refetch introduces a handle cooldown (expired: %s)', async (expired) => {
    vi.setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
    const { client } = renderField('handle');
    await act(async () => vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000));
    const changedAt = expired ? Date.now() - (7 * 24 + 1) * 60 * 60 * 1000 : Date.now();
    act(() => client.setQueryData(profileQueryKey(profile.id), { ...profile, handle: 'new-ada', version: 2, lastHandleChangedAt: new Date(changedAt).toISOString() }));
    await flush();
    const edit = screen.getByRole('button', { name: 'Edit profile handle' });
    if (expired) {
      expect(edit).toBeEnabled();
      expect(screen.queryByText(/Available for change/)).not.toBeInTheDocument();
    } else {
      expect(edit).toBeDisabled();
      expect(screen.getByRole('button', { name: '7 days' })).toBeInTheDocument();
    }
  });

  it.each(['stay', 'external', 'external-then-blur'])('restores biography focus after native disabled-button blur without stealing focus (%s)', async (destination) => {
    let resolve: ((value: Profile) => void) | undefined;
    vi.mocked(userApi.updateProfile).mockImplementation(() => new Promise((done) => { resolve = done; }));
    renderField('biographyMarkdown');
    fireEvent.click(screen.getByRole('button', { name: 'Edit biography' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Saved biography' } });
    const save = screen.getByRole('button', { name: 'Save biography' });
    act(() => save.focus());
    fireEvent.click(save);
    await flush();
    expect(screen.getByRole('button', { name: 'Saving biography' })).toBeDisabled();
    // Real browsers can drop focus to the body when the focused save button disables.
    act(() => {
      // jsdom keeps disabled buttons focused even when blur() is called.
      document.body.tabIndex = -1;
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    expect(document.body).toHaveFocus();
    const external = screen.getByRole('button', { name: 'Other action' });
    if (destination !== 'stay') act(() => external.focus());
    if (destination === 'external-then-blur') act(() => external.blur());
    await act(async () => resolve?.({ ...profile, biographyMarkdown: 'Saved biography', version: 2 }));
    await flush();
    await act(async () => vi.advanceTimersByTimeAsync(1600));
    if (destination === 'stay') expect(screen.getByRole('button', { name: 'Edit biography' })).toHaveFocus();
    else if (destination === 'external') expect(external).toHaveFocus();
    else expect(document.body).toHaveFocus();
  });

});
