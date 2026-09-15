import { useIsFetching, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  countProfileMarkdownCharacters,
  validateProfileMarkdown,
} from '@wallpaperdb/profile-markdown';
import { useEffect, useState } from 'react';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { BiographyMarkdown } from '@/components/profile/profile-biography';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { userApi, UserApiError, type Profile } from '@/lib/api/user';

export function ProfileBiographySettings({
  profile,
  tokenProvider,
}: {
  profile: Profile;
  tokenProvider: () => Promise<string | null>;
}) {
  const queryClient = useQueryClient();
  const refreshing = useIsFetching({ queryKey: profileQueryKey(profile.id) }) > 0;
  const writing = useIsMutating({ mutationKey: profileQueryKey(profile.id) }) > 0;
  const [edit, setEdit] = useState({
    value: profile.biographyMarkdown,
    baseValue: profile.biographyMarkdown,
    baseVersion: profile.version,
  });
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState<string | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const draft = edit.value;
  useEffect(() => {
    setEdit((current) =>
      current.value === current.baseValue
        ? {
            value: profile.biographyMarkdown,
            baseValue: profile.biographyMarkdown,
            baseVersion: profile.version,
          }
        : current
    );
  }, [profile.biographyMarkdown, profile.version]);
  const maxCharacters = profile.biographyMaxLength ?? 5000;
  const validation = validateProfileMarkdown(draft, { maxCharacters });
  const mutation = useMutation({
    mutationKey: profileQueryKey(profile.id),
    mutationFn: (command: { biographyMarkdown: string; expectedVersion: number }) =>
      userApi.updateProfile({ ...command, expectedProfileId: profile.id, tokenProvider }),
    onSuccess: (updated) => {
      queryClient.setQueryData(profileQueryKey(profile.id), updated);
      setPreviewRevision((revision) => revision + 1);
      setEdit({
        value: updated.biographyMarkdown,
        baseValue: updated.biographyMarkdown,
        baseVersion: updated.version,
      });
    },
  });
  const error =
    refreshError ??
    (mutation.error instanceof UserApiError &&
    mutation.error.type?.endsWith('/profile-version-conflict')
      ? 'Your Profile changed elsewhere. Refresh Biography before saving again.'
      : mutation.error?.message);
  async function refresh() {
    if (refreshing || writing) return;
    mutation.reset();
    setRefreshError(null);
    setRefreshed(null);
    const dirty = edit.value !== edit.baseValue;
    try {
      await queryClient.refetchQueries(
        { queryKey: profileQueryKey(profile.id), exact: true },
        { throwOnError: true }
      );
      const updated = queryClient.getQueryData<Profile>(profileQueryKey(profile.id));
      if (!updated) throw new Error('Profile unavailable');
      setPreviewRevision((revision) => revision + 1);
      setEdit((current) => ({
        value: dirty ? current.value : updated.biographyMarkdown,
        baseValue: updated.biographyMarkdown,
        baseVersion: updated.version,
      }));
      setRefreshed(
        dirty ? 'Biography refreshed. Your unsaved draft is preserved.' : 'Biography refreshed.'
      );
    } catch {
      setRefreshError('Unable to refresh Biography. Try again.');
    }
  }
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Biography</CardTitle>
        <CardDescription>Tell people about yourself and your wallpaper collection.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              draft !== profile.biographyMarkdown &&
              validation.valid &&
              !refreshing &&
              !writing
            ) {
              setRefreshed(null);
              setRefreshError(null);
              mutation.mutate({ biographyMarkdown: draft, expectedVersion: edit.baseVersion });
            }
          }}
        >
          <Field>
            <FieldLabel htmlFor="biography-markdown">Biography Markdown</FieldLabel>
            <Textarea
              id="biography-markdown"
              value={draft}
              rows={7}
              className="max-h-96 min-h-40 font-mono text-sm"
              disabled={writing || refreshing}
              onChange={(event) => {
                setEdit((current) => ({ ...current, value: event.target.value }));
                mutation.reset();
                setRefreshed(null);
              }}
            />
            <p className="text-sm text-muted-foreground">
              {countProfileMarkdownCharacters(draft)} / {maxCharacters} characters
            </p>
            <FieldDescription>
              Use headings, lists, emphasis, tables, and HTTPS links. Embed a published wallpaper
              you own with <code className="break-all">![Alt text](wallpaper:wallpaper-id)</code>.
              New uploads may take a moment to become available.
            </FieldDescription>
          </Field>
          {!validation.valid && (
            <Alert variant="destructive">
              <AlertDescription>{validation.errors[0]?.message}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {refreshed && (
            <output className="block text-sm text-muted-foreground">{refreshed}</output>
          )}
          {mutation.isSuccess && (
            <Alert>
              <AlertDescription>
                Biography saved. Public views may take a moment to update.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={
                draft === profile.biographyMarkdown || !validation.valid || refreshing || writing
              }
            >
              Save Biography
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={refreshing || writing}
              onClick={() => void refresh()}
            >
              Refresh Biography
            </Button>
          </div>
        </form>
        <section aria-labelledby="biography-preview-title" className="mt-6 min-w-0 border-t pt-5">
          <h3
            id="biography-preview-title"
            className="mb-3 text-sm font-semibold text-muted-foreground"
          >
            Biography preview
          </h3>
          <BiographyMarkdown
            markdown={draft}
            profileId={profile.id}
            maxCharacters={maxCharacters}
            refreshKey={previewRevision}
          />
        </section>
      </CardContent>
    </Card>
  );
}
