export type ProfileField = 'displayName' | 'handle' | 'biographyMarkdown';
export type SavePhase = 'idle' | 'saving' | 'success' | 'error';

export interface EditableProfile {
  id: string;
  version: number;
  displayName: string;
  handle: string;
  biographyMarkdown: string;
  biographyMaxLength?: number;
  lastHandleChangedAt?: number | null;
  retainedAliasLimit?: number;
  aliases?: { handle: string; expiresAt?: string | null }[];
}

export interface ProfileDraft {
  value: string;
  baseValue: string;
  baseVersion: number;
  baseProfile: EditableProfile;
}

export type SaveResult =
  | { success: true; profile: EditableProfile }
  | {
      success: false;
      error: { message: string; versionConflict?: boolean; nextHandleChangeAt?: number };
    };

export interface EditorNotice {
  kind: 'success' | 'error';
  message: string;
  description?: string;
}

export interface ProfileEditorDependencies {
  save: (command: ProfileDraft) => Promise<SaveResult>;
  refresh: () => Promise<EditableProfile>;
  notify: (notice: EditorNotice) => void;
  clock: { now: () => number; schedule: (delayMs: number, callback: () => void) => () => void };
}

export interface ProfileEditorOptions {
  field: ProfileField;
  profile: EditableProfile;
  displayNameMaxLength: number;
}

export interface ProfileEditorSnapshot {
  edit: ProfileDraft | null;
  phase: SavePhase;
  error: string | null;
  conflict: boolean;
  refreshing: boolean;
  confirmation: { command: ProfileDraft; aliases: string[] } | null;
  validationError: string | undefined;
  busy: boolean;
  locked: boolean;
  canSave: boolean;
  deadline: number;
  now: number;
  coolingDown: boolean;
}
