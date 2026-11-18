import type { ExecutionSettings, ExecutionCatalog } from './contract.js';
export function supportsExecutionSettings(catalog: ExecutionCatalog, settings: ExecutionSettings) {
  const model = catalog.models.find((m) => m.id === settings.model);
  return (
    !!model &&
    (settings.effort === null || model.efforts.includes(settings.effort)) &&
    (settings.mode === null || model.modes.includes(settings.mode)) &&
    (settings.permissionLevel === null ||
      catalog.permissionLevels.includes(settings.permissionLevel))
  );
}
