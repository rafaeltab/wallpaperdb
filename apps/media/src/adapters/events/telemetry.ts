import type { ProjectionInput } from '../../catalog/index.js';
/** Deliberate metadata allowlist: no profile text, payload or storage locations. */
export function inputAttributes(input: ProjectionInput | undefined) {
  if (!input) return {};
  const domain =
    input.kind === 'profile'
      ? { 'profile.id': input.profile.id }
      : {
          'wallpaper.id':
            input.kind === 'wallpaper' ? input.wallpaper.id : input.variant.wallpaperId,
        };
  return {
    ...domain,
    'event.source': input.occurrence.source,
    'event.id': input.occurrence.id,
    ...(input.correlationId ? { 'event.correlation_id': input.correlationId } : {}),
    ...(input.causationId ? { 'event.causation_id': input.causationId } : {}),
    ...(input.causationSource ? { 'event.causation_source': input.causationSource } : {}),
  };
}
