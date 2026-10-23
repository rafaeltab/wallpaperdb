import { Effect, Layer } from 'effect';
import {
  Lifecycle,
  LifecycleStore,
  type Acceptance,
  type Command,
  type LifecyclePolicy,
} from './contract.js';

function canonical(command: Command) {
  if ('invalid' in command)
    return JSON.stringify([
      command.operation,
      'malformed',
      command.payloadIdentity,
      command.commandId,
      command.applicationReference,
    ]);
  return command.operation === 'create'
    ? JSON.stringify([
        command.operation,
        command.commandId,
        command.applicationReference,
        command.assetType,
        command.ownerSubject,
      ])
    : JSON.stringify([
        command.operation,
        command.commandId,
        command.applicationReference,
        command.assetId,
      ]);
}
export function lifecycleLayer(policy: LifecyclePolicy) {
  return Layer.effect(
    Lifecycle,
    Effect.gen(function* () {
      const store = yield* LifecycleStore;
      return Lifecycle.of({
        command: Effect.fn('asset.lifecycle.command')(function* (applicationId, command, context) {
          const application = Object.hasOwn(policy.applications, applicationId)
            ? policy.applications[applicationId]
            : undefined;
          let decision: Acceptance['decision'];
          if ('invalid' in command) decision = { kind: 'reject', reason: 'malformed-command' };
          else if (!application?.allowedOperations.includes(command.operation))
            decision = { kind: 'reject', reason: 'forbidden-operation' };
          else if (command.operation === 'delete')
            decision = {
              kind: 'delete',
              assetId: command.assetId,
              evidenceRetentionMsByType: Object.fromEntries(
                Object.entries(policy.assetTypes).map(([type, policy]) => [
                  type,
                  policy.retention.evidenceMs,
                ])
              ),
            };
          else if (!application.allowedTypes.includes(command.assetType))
            decision = { kind: 'reject', reason: 'unsupported-type' };
          else
            decision = {
              kind: 'create',
              assetType: command.assetType,
              owner: { namespace: application.ownerNamespace, subject: command.ownerSubject },
            };
          return yield* store.accept({
            context,
            revision: policy.revision,
            applicationId,
            canonical: canonical(command),
            correlation: {
              commandId: command.commandId,
              applicationReference: command.applicationReference,
            },
            decision,
          });
        }),
        inspect: Effect.fn('asset.lifecycle.inspect')(function* (owner, assetId) {
          const asset = yield* store.find(assetId);
          if (
            !asset ||
            asset.owner.namespace !== owner.namespace ||
            asset.owner.subject !== owner.subject
          )
            return { kind: 'unavailable' as const };
          return {
            kind: 'found' as const,
            asset: {
              assetId: asset.id,
              assetType: asset.assetType,
              sources: [],
              defaultSourceId: null,
              sourceSetRevision: '0' as const,
            },
          };
        }),
      });
    })
  );
}
