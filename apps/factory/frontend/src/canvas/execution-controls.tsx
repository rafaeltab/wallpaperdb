import { useId } from 'react';
import type { Board } from './model';
type Settings = NonNullable<Board['meta']['factory']['execution']>;
export const inheritedExecution: Settings = {
  model: 'gpt-6.1-sol',
  effort: null,
  mode: null,
  permissionLevel: null,
};
const permissionLabels = {
  'approval-required': 'Approval required',
  'auto-accept-edits': 'Automatically approve edits',
  auto: 'Automatic within sandbox',
  'full-access': 'Full access without approvals',
};
export function ExecutionControls({
  settings,
  catalog,
  change,
}: {
  settings: Settings;
  catalog: Board['meta']['factory']['executionCatalog'];
  change: (settings: Settings) => void;
}) {
  const modelChoicesId = useId();
  const model = catalog?.models.find((m) => m.id === settings.model);
  return (
    <fieldset>
      <legend>Execution settings</legend>
      {!catalog && (
        <p role="status">
          Execution choices are unavailable. Check the T3 connection. Scheduling controls can still
          be saved.
        </p>
      )}
      <label>
        Model
        <input
          aria-label="Model"
          list={modelChoicesId}
          required
          maxLength={200}
          disabled={!catalog}
          value={settings.model}
          onChange={(e) => change({ ...settings, model: e.target.value })}
        />
        <datalist id={modelChoicesId}>
          {catalog?.models.map((m) => (
            <option key={m.id} value={m.id} />
          ))}
        </datalist>
      </label>
      <p>
        Type a supported model ID if it is missing from suggestions. Save the model to load its
        available effort and mode choices.
      </p>
      <label>
        Reasoning effort
        <select
          aria-label="Reasoning effort"
          disabled={!catalog}
          value={settings.effort ?? ''}
          onChange={(e) => change({ ...settings, effort: e.target.value || null })}
        >
          <option value="">Inherited/default</option>
          {settings.effort && !model?.efforts.includes(settings.effort) && (
            <option value={settings.effort}>
              {settings.effort} ({model ? 'unavailable' : 'verify on save'})
            </option>
          )}
          {model?.efforts.map((effort) => (
            <option key={effort} value={effort}>
              {effort}
            </option>
          ))}
        </select>
      </label>
      <label>
        Execution mode
        <select
          aria-label="Execution mode"
          disabled={!catalog}
          value={settings.mode ?? ''}
          onChange={(e) =>
            change({
              ...settings,
              mode:
                e.target.value === 'standard'
                  ? 'standard'
                  : e.target.value === 'fast'
                    ? 'fast'
                    : null,
            })
          }
        >
          <option value="">Inherited/default</option>
          {settings.mode && !model?.modes.includes(settings.mode) && (
            <option value={settings.mode}>
              {settings.mode} ({model ? 'unavailable' : 'verify on save'})
            </option>
          )}
          {model?.modes.map((mode) => (
            <option key={mode} value={mode}>
              {mode === 'fast' ? 'Fast' : 'Standard'}
            </option>
          ))}
        </select>
      </label>
      <label>
        Permission level
        <select
          aria-label="Permission level"
          disabled={!catalog}
          value={settings.permissionLevel ?? ''}
          onChange={(e) =>
            change({
              ...settings,
              permissionLevel: catalog?.permissionLevels.find((p) => p === e.target.value) ?? null,
            })
          }
        >
          <option value="">Inherited/default</option>
          {settings.permissionLevel &&
            !catalog?.permissionLevels.includes(settings.permissionLevel) && (
              <option value={settings.permissionLevel}>
                {settings.permissionLevel} (unavailable)
              </option>
            )}
          {catalog?.permissionLevels.map((level) => (
            <option key={level} value={level}>
              {permissionLabels[level]}
            </option>
          ))}
        </select>
      </label>
      <p>
        Fast requests priority processing, independently of reasoning effort. Inherited values use
        T3 defaults.
      </p>
      <p>
        Permissions control file and command access and approval prompts. T3 restrictions still
        apply; supervised modes may wait for your approval.
      </p>
      <p>
        Changes apply to new jobs and planner or recovery launches. Existing jobs, stages and
        retries keep their captured settings.
      </p>
    </fieldset>
  );
}
export function ExecutionSummary({
  settings,
  observed,
  observedModel,
}: {
  settings: Settings | undefined;
  observedModel?: string;
  observed?: {
    model: string;
    effort: string | null;
    serviceTier: string | null;
    permissionLevel: string;
  };
}) {
  return (
    <div>
      <p>
        Captured model: {settings?.model ?? 'Unknown'}. Effort:{' '}
        {settings ? (settings.effort ?? 'Inherited/default') : 'Unknown'}. Mode:{' '}
        {settings ? (settings.mode ?? 'Inherited/default') : 'Unknown'}. Permission level:{' '}
        {settings
          ? settings.permissionLevel
            ? permissionLabels[settings.permissionLevel]
            : 'Inherited/default'
          : 'Unknown'}
        .
      </p>
      <p>
        Observed model: {observed?.model ?? observedModel ?? 'Unknown'}. Effort:{' '}
        {observed ? (observed.effort ?? 'Inherited/default (effective value unknown)') : 'Unknown'}.
        Mode:{' '}
        {observed
          ? observed.serviceTier === 'priority'
            ? 'Fast'
            : observed.serviceTier === 'default'
              ? 'Standard'
              : (observed.serviceTier ?? 'Inherited/default (effective value unknown)')
          : 'Unknown'}
        . Permission level: {observed?.permissionLevel ?? 'Unknown'}.
      </p>
    </div>
  );
}
