import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import {
  profileQueryKey,
  useOwnerProfileMutation,
} from '@/features/profile-management/adapters/query';
import { type Profile, UserApiError, userApi } from '@/lib/api/user';
import { createPictureEditor, type PictureCommand, type PictureSaveResult } from '../index';
import { openPictureSource } from './browser';

/** Public React adapter for the Profile picture editing workflow and browser resources. */
export function usePictureEditor(profile: Profile, tokenProvider: () => Promise<string | null>) {
  const { mutation, refresh, availability, ownership, refreshing, writing } =
    useOwnerProfileMutation(profile.id, (command: PictureCommand) => {
      const options = {
        expectedVersion: command.expectedVersion,
        expectedProfileId: profile.id,
        tokenProvider,
      };
      return command.action === 'upload'
        ? userApi.uploadPicture({ ...options, picture: command.picture })
        : userApi.removePicture(options);
    });
  const latest = useRef({ mutation, refresh, profile });
  latest.current = { mutation, refresh, profile };
  const editor = useMemo(
    () =>
      createPictureEditor(
        {
          version: latest.current.profile.version,
          limits: latest.current.profile.pictureUploadLimits,
        },
        {
          availability,
          ownership,
          async save(command): Promise<PictureSaveResult> {
            try {
              await latest.current.mutation.mutateAsync(command);
              return { success: true };
            } catch (cause) {
              return {
                success: false,
                error: {
                  message:
                    cause instanceof Error
                      ? cause.message
                      : 'Unable to save this picture. Try again.',
                  versionConflict:
                    cause instanceof UserApiError &&
                    Boolean(cause.type?.endsWith('/profile-version-conflict')),
                },
              };
            }
          },
          refresh: () => latest.current.refresh(),
          notify: (message) => toast.success(message),
          openSource: openPictureSource,
          previews: {
            create: (preview) => URL.createObjectURL(preview),
            release: (url) => URL.revokeObjectURL(url),
          },
        }
      ),
    [availability, ownership]
  );
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  useEffect(() => editor.activate(), [editor]);
  useEffect(
    () => editor.receiveProfile({ version: profile.version, limits: profile.pictureUploadLimits }),
    [editor, profile]
  );
  const policyQuery = useQuery({
    queryKey: [...profileQueryKey(profile.id), 'picture-policy'],
    queryFn: ({ signal }) => userApi.picturePolicy({ signal, tokenProvider }),
    enabled: state.open,
    retry: false,
  });
  const policy = policyQuery.data;
  const policyReady = Boolean(policy) && !policyQuery.isError && !policyQuery.isFetching;
  return {
    editor,
    state,
    policyQuery,
    policy,
    policyReady,
    refreshing,
    writing,
    saving: mutation.isPending,
  };
}
