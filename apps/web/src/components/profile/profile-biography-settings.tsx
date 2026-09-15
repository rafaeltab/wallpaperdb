import { useIsFetching, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { countProfileMarkdownCharacters, validateProfileMarkdown } from '@wallpaperdb/profile-markdown';
import { useState } from 'react';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { userApi, type Profile } from '@/lib/api/user';

export function ProfileBiographySettings({ profile, tokenProvider }: {
  profile: Profile;
  tokenProvider: () => Promise<string | null>;
}) {
  const queryClient = useQueryClient();
  const refreshing = useIsFetching({ queryKey: profileQueryKey(profile.id) }) > 0;
  const writing = useIsMutating({ mutationKey: profileQueryKey(profile.id) }) > 0;
  const [draft, setDraft] = useState(profile.biographyMarkdown);
  const maxCharacters = profile.biographyMaxLength ?? 5000;
  const validation = validateProfileMarkdown(draft, { maxCharacters });
  const mutation = useMutation({
    mutationKey: profileQueryKey(profile.id),
    mutationFn: (command: { biographyMarkdown: string; expectedVersion: number }) => userApi.updateProfile({ ...command, expectedProfileId: profile.id, tokenProvider }),
    onSuccess: (updated) => {
      queryClient.setQueryData(profileQueryKey(profile.id), updated);
      setDraft(updated.biographyMarkdown);
    },
  });
  return <Card className="mt-6">
    <CardHeader>
      <CardTitle>Biography</CardTitle>
      <CardDescription>Tell people about yourself and your wallpaper collection.</CardDescription>
    </CardHeader>
    <CardContent>
      <form className="space-y-5" onSubmit={(event) => {
        event.preventDefault();
        if (validation.valid && !refreshing && !writing) mutation.mutate({ biographyMarkdown: draft, expectedVersion: profile.version });
      }}>
        <Field>
          <FieldLabel htmlFor="biography-markdown">Biography Markdown</FieldLabel>
          <Textarea id="biography-markdown" value={draft} rows={7} disabled={writing} onChange={(event) => { setDraft(event.target.value); mutation.reset(); }} />
          <p className="text-sm text-muted-foreground">{countProfileMarkdownCharacters(draft)} / {maxCharacters} characters</p>
        </Field>
        {!validation.valid && <Alert variant="destructive"><AlertDescription>{validation.errors[0]?.message}</AlertDescription></Alert>}
        {mutation.error && <Alert variant="destructive"><AlertDescription>{mutation.error.message}</AlertDescription></Alert>}
        {mutation.isSuccess && <Alert><AlertDescription>Biography saved. Public views may take a moment to update.</AlertDescription></Alert>}
        <Button type="submit" disabled={!validation.valid || refreshing || writing}>Save Biography</Button>
      </form>
    </CardContent>
  </Card>;
}
