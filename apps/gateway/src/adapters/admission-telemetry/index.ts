import { recordCounter } from '@wallpaperdb/core/telemetry';
import { Effect, Layer } from 'effect';
import { AdmissionTelemetry } from '../../capabilities/admission/index.js';

export const admissionTelemetryLayer = Layer.succeed(AdmissionTelemetry, {
  record: (event) =>
    Effect.try(() => {
      switch (event._tag) {
        case 'Charged':
          return recordCounter('admission.cost.charged', event.points, { mode: event.mode });
        case 'Denied':
          return recordCounter('admission.quota.denied', 1, { mode: event.mode });
        case 'Fallback':
          return recordCounter('admission.quota.fallback', 1, { reason: event.reason });
        case 'Recovery':
          return recordCounter('admission.quota.recovery', 1);
        case 'LocalStateSaturated':
          return recordCounter('admission.quota.saturated', 1, { reason: 'local_state' });
        case 'Disabled':
          return recordCounter('admission.quota.disabled', 1);
      }
    }).pipe(Effect.ignore),
});

export { quotaUsageTelemetryLayer } from './usage.js';
