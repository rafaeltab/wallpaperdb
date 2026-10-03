import { useIsFetching, useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { profileQueryKey } from '@/components/profile-bootstrap';
import { type Profile, UserApiError, userApi } from '@/lib/api/user';
import { positiveIntegerEnv } from '@/lib/runtime-config';
import {
  createProfileEditor,
  type EditableProfile,
  type ProfileDraft,
  type ProfileField,
  type SaveResult,
} from '../index';

function editableProfile(profile: Profile): EditableProfile {
  return {
    ...profile,
    lastHandleChangedAt: profile.lastHandleChangedAt
      ? Date.parse(profile.lastHandleChangedAt)
      : null,
  };
}

export function useProfileEditor(
  field: ProfileField,
  profile: Profile,
  tokenProvider: () => Promise<string | null>
) {
  const queryClient = useQueryClient();
  const key = profileQueryKey(profile.id);
  const busy = useIsFetching({ queryKey: key }) > 0;
  const writing = useIsMutating({ mutationKey: key }) > 0;
  const mutation = useMutation({
    mutationKey: key,
    mutationFn(command: ProfileDraft) {
      const options = {
        expectedVersion: command.baseVersion,
        expectedProfileId: profile.id,
        tokenProvider,
      };
      return field === 'handle'
        ? userApi.updateHandle({ ...options, handle: command.value })
        : userApi.updateProfile({ ...options, [field]: command.value });
    },
  });
  const latest = useRef({ mutation, key });
  latest.current = { mutation, key };
  const initial = useMemo(() => editableProfile(profile), [profile]);
  const [editor] = useState(() =>
    createProfileEditor(
      {
        field,
        profile: initial,
        displayNameMaxLength: positiveIntegerEnv(
          import.meta.env.VITE_PROFILE_DISPLAY_NAME_MAX_LENGTH,
          80
        ),
      },
      {
        async save(command): Promise<SaveResult> {
          const { key, mutation } = latest.current;
          // The original query object identifies the owner session, even if its key is reused.
          const ownerQuery = queryClient.getQueryCache().find({ queryKey: key, exact: true });
          try {
            const updated = await mutation.mutateAsync(command);
            if (
              ownerQuery &&
              queryClient.getQueryCache().find({ queryKey: key, exact: true }) === ownerQuery
            )
              queryClient.setQueryData(key, updated);
            return { success: true, profile: editableProfile(updated) };
          } catch (cause) {
            return {
              success: false,
              error: {
                message:
                  cause instanceof Error
                    ? cause.message
                    : `Unable to save ${field === 'handle' ? 'profile handle' : field === 'displayName' ? 'display name' : 'biography'}.`,
                versionConflict:
                  cause instanceof UserApiError &&
                  Boolean(cause.type?.endsWith('/profile-version-conflict')),
                nextHandleChangeAt:
                  cause instanceof UserApiError && cause.nextHandleChangeAt
                    ? Date.parse(cause.nextHandleChangeAt)
                    : undefined,
              },
            };
          }
        },
        async refresh() {
          const { key } = latest.current;
          await queryClient.refetchQueries({ queryKey: key, exact: true }, { throwOnError: true });
          const updated = queryClient.getQueryData<Profile>(key);
          if (!updated) throw new Error('Profile unavailable');
          return editableProfile(updated);
        },
        notify: ({ kind, message, description }) => {
          if (kind === 'success') toast.success(message);
          else if (description) toast.error(message, { description });
          else toast.error(message);
        },
        clock: {
          now: () => Date.now(),
          schedule(delay, callback) {
            const timer = setTimeout(callback, delay);
            return () => clearTimeout(timer);
          },
        },
      }
    )
  );
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  useEffect(() => editor.activate(), [editor]);
  useEffect(() => editor.receiveProfile(initial), [editor, initial]);
  useEffect(() => editor.setBusy(busy || writing), [editor, busy, writing]);
  function coordinated<Args extends unknown[], Result>(action: (...args: Args) => Result) {
    return (...args: Args): Result => {
      editor.setBusy(
        queryClient.isFetching({ queryKey: key }) > 0 ||
          queryClient.isMutating({ mutationKey: key }) > 0
      );
      return action(...args);
    };
  }
  return {
    editor: {
      ...editor,
      beginEdit: coordinated(editor.beginEdit),
      change: coordinated(editor.change),
      save: coordinated(editor.save),
      confirmSave: coordinated(editor.confirmSave),
      refresh: coordinated(editor.refresh),
    },
    state: {
      ...state,
      busy: busy || writing || state.busy,
      canSave: state.canSave && !busy && !writing,
    },
  };
}
