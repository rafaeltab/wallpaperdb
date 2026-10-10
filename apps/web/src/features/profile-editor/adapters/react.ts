import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { useOwnerProfileMutation } from '@/features/profile-management/adapters/query';
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
  const { mutation, refresh, availability } = useOwnerProfileMutation(
    profile.id,
    (command: ProfileDraft) => {
      const options = {
        expectedVersion: command.baseVersion,
        expectedProfileId: profile.id,
        tokenProvider,
      };
      return field === 'handle'
        ? userApi.updateHandle({ ...options, handle: command.value })
        : userApi.updateProfile({ ...options, [field]: command.value });
    }
  );
  const initial = useMemo(() => editableProfile(profile), [profile]);
  const latest = useRef({ mutation, refresh, initial });
  latest.current = { mutation, refresh, initial };
  const editor = useMemo(
    () =>
      createProfileEditor(
        {
          field,
          profile: latest.current.initial,
          displayNameMaxLength: positiveIntegerEnv(
            import.meta.env.VITE_PROFILE_DISPLAY_NAME_MAX_LENGTH,
            80
          ),
        },
        {
          availability,
          async save(command): Promise<SaveResult> {
            const { mutation } = latest.current;
            try {
              const updated = await mutation.mutateAsync(command);
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
            return editableProfile(await latest.current.refresh());
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
      ),
    [field, availability]
  );
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  useEffect(() => editor.activate(), [editor]);
  useEffect(() => editor.receiveProfile(initial), [editor, initial]);
  return { editor, state };
}
