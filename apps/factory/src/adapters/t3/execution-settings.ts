import { Effect } from 'effect';
import { z } from 'zod';
import {
  Unavailable,
  supportsExecutionSettings,
  type ExecutionCatalog,
  type ExecutionConfiguration,
  type ExecutionSettings,
} from '../../capabilities/job/index.js';
import { command, executionSettingsSchema } from '../../platform/index.js';
import { mcpCall } from './questions.js';
import type { T3Observations } from './observations.js';

interface Configuration {
  binary: string;
  project: string;
  projectId: string;
  mcpEndpoint?: string;
  mcpAuthorizationFile?: string;
  observations?: T3Observations;
}
const permissionLevels = ['approval-required', 'auto-accept-edits', 'auto', 'full-access'] as const;
const permission = z.enum(permissionLevels);
const capabilities = z.object({
  runtimeMode: permission,
  providers: z.array(
    z.object({
      providerInstanceId: z.string(),
      constraints: z.array(z.string()),
      runtimeModes: z.array(permission).optional(),
      models: z.array(
        z.object({
          id: z.string(),
          options: z
            .array(
              z.object({ id: z.string(), values: z.array(z.union([z.string(), z.boolean()])) })
            )
            .optional(),
        })
      ),
    })
  ),
});
export function t3ExecutionConfiguration(config: Configuration): ExecutionConfiguration {
  return {
    catalog: (model) =>
      Effect.tryPromise({
        try: (signal) => readCatalog(config, signal, model),
        catch: (cause) => new Unavailable({ operation: 'execution-capabilities', cause }),
      }).pipe(
        Effect.tapError(Effect.logError),
        Effect.withSpan('factory.t3.execution-capabilities')
      ),
  };
}
async function readCatalog(
  config: Configuration,
  signal?: AbortSignal,
  requestedModel?: string
): Promise<ExecutionCatalog> {
  const result = capabilities.parse(await mcpCall(config, 'orchestrator_capabilities', {}, signal));
  const provider = result.providers.find((p) => p.providerInstanceId === 'codex');
  if (!provider || provider.constraints.length)
    throw new Error(
      'The configured Codex provider is unavailable. Check the T3 provider configuration.'
    );
  const ceiling = permissionLevels.indexOf(result.runtimeMode);
  const models = [...provider.models];
  if (requestedModel && !models.some((model) => model.id === requestedModel)) {
    const searched = capabilities.parse(
      await mcpCall(config, 'orchestrator_capabilities', { search: requestedModel }, signal)
    );
    const candidate = searched.providers.find((p) => p.providerInstanceId === 'codex');
    if (!candidate || candidate.constraints.length)
      throw new Error(
        'The configured Codex provider is unavailable. Check the T3 provider configuration.'
      );
    const selected = candidate.models.find((model) => model.id === requestedModel);
    if (selected) models.push(selected);
  }
  return {
    models: models.map((model) => {
      const efforts =
        model.options
          ?.find((o) => o.id === 'reasoningEffort')
          ?.values.filter((v): v is string => typeof v === 'string') ?? [];
      const tiers = model.options?.find((o) => o.id === 'serviceTier')?.values ?? [];
      return {
        id: model.id,
        efforts,
        modes: [
          ...(tiers.includes('default') ? ['standard' as const] : []),
          ...(tiers.includes('priority') ? ['fast' as const] : []),
        ],
      };
    }),
    permissionLevels: (provider.runtimeModes ?? permissionLevels).filter(
      (level) => permissionLevels.indexOf(level) <= ceiling
    ),
  };
}
export async function prepareExecution(
  config: Configuration,
  request: { title: string; message: string; base?: string; branch?: string },
  settings: ExecutionSettings | undefined,
  signal?: AbortSignal
) {
  if (!settings) {
    return async (launchSignal: AbortSignal | undefined = signal) =>
      JSON.parse(
        await command(
          config.binary,
          [
            'thread',
            'start',
            config.projectId,
            request.base ? request.message : '-',
            '--title',
            request.title,
            '--provider',
            'codex',
            '--model',
            'gpt-6.1-sol',
            ...(request.base ? ['--worktree', request.base, '--branch', request.branch ?? ''] : []),
            '--json',
          ],
          config.project,
          launchSignal,
          undefined,
          request.base ? undefined : request.message
        )
      );
  }
  const catalog = await readCatalog(config, signal, settings.model);
  if (!supportsExecutionSettings(catalog, settings)) {
    throw new Error(
      'Saved execution settings are unavailable. Refresh Factory settings and select a supported model, effort, mode and permission level.'
    );
  }
  const options = [
    ...(settings.effort === null ? [] : [{ id: 'reasoningEffort', value: settings.effort }]),
    ...(settings.mode === null
      ? []
      : [{ id: 'serviceTier', value: settings.mode === 'fast' ? 'priority' : 'default' }]),
  ];
  return (launchSignal: AbortSignal | undefined = signal) =>
    mcpCall(
      config,
      't3_thread_launch',
      {
        projectId: config.projectId,
        title: request.title,
        message: request.message,
        modelSelection: { instanceId: 'codex', model: settings.model, options },
        ...(settings.permissionLevel === null ? {} : { runtimeMode: settings.permissionLevel }),
        ...(request.base
          ? {
              workspaceStrategy: {
                type: 'worktree',
                baseRef: request.base,
                branch: request.branch,
                startFromOrigin: false,
              },
            }
          : {}),
      },
      launchSignal
    );
}
export function retainedExecution(value: unknown): ExecutionSettings | undefined {
  return value == null ? undefined : executionSettingsSchema.parse(value);
}
export function executionInstructions(settings?: ExecutionSettings) {
  if (!settings) return 'All agents and fresh independent reviewers use gpt-6.1-sol.';
  const options = [
    ...(settings.effort === null ? [] : [`reasoningEffort: '${settings.effort}'`]),
    ...(settings.mode === null
      ? []
      : [`serviceTier: '${settings.mode === 'fast' ? 'priority' : 'default'}'`]),
  ];
  return `All agents and fresh independent reviewers use Codex model ${settings.model}. These factory execution settings override skill model defaults. Preserve them for independent reviews: target.options = {${options.join(', ')}}. ${settings.permissionLevel === null ? 'Inherit the owning thread permission level.' : `Use permission level ${settings.permissionLevel}; do not broaden it.`}`;
}

export async function observeExecutionSettings(
  config: Configuration,
  threadId: string,
  signal?: AbortSignal
) {
  const result = z
    .object({
      threadId: z.literal(threadId),
      runtimeMode: permission,
      modelSelection: z.object({
        instanceId: z.literal('codex'),
        model: z.string(),
        options: z
          .array(z.object({ id: z.string(), value: z.union([z.string(), z.boolean()]) }))
          .optional(),
      }),
    })
    .parse(await mcpCall(config, 't3_thread_configure', { threadId }, signal));
  const selected = (id: string) => {
    const value = result.modelSelection.options?.find((o) => o.id === id)?.value;
    return typeof value === 'string' ? value : null;
  };
  return {
    model: result.modelSelection.model,
    effort: selected('reasoningEffort'),
    serviceTier: selected('serviceTier'),
    permissionLevel: result.runtimeMode,
  };
}
