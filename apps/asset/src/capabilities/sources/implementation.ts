import { Clock, Effect, Layer } from 'effect';
import type { Owner, CommandContext } from '../lifecycle/index.js';
import {
  Sources,
  SourceStore,
  SourceBytes,
  MandatoryInspection,
  SourceFailure,
  type Candidate,
  type CandidateSelection,
  type CandidateIntent,
  type SourceOutcome,
  type SourceChangeOutcome,
  type SourceState,
  type SourceFacts,
  type SourcesPort,
} from './contract.js';
import { resolveSourceOperations, type SourcePolicy } from './policy.js';
const unavailable = { kind: 'unavailable' } as const;
const nonterminal = (candidate: Candidate) =>
  !['accepted', 'rejected', 'cancelled'].includes(candidate.status);
const reject = (reason: string): SourceOutcome => ({ kind: 'rejected', reason });
const result = (candidate: Candidate): SourceOutcome => ({
  kind: 'candidate',
  candidate: structuredClone(candidate),
});
const owns = (owner: Owner, state: SourceState | null): state is SourceState =>
  !!state &&
  owner.namespace === state.asset.owner.namespace &&
  owner.subject === state.asset.owner.subject;
const validOwner = (owner: Owner) =>
  [owner.namespace, owner.subject].every(
    (v) =>
      typeof v === 'string' &&
      new TextEncoder().encode(v).length > 0 &&
      new TextEncoder().encode(v).length <= 256
  );
const validRevision = (value: string) =>
  typeof value === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(value);
const sameIntent = (a: CandidateIntent, b: CandidateIntent) =>
  a.operation === b.operation &&
  a.expectedSourceSetRevision === b.expectedSourceSetRevision &&
  a.targetSourceId === b.targetSourceId;
function policyRejection(facts: SourceFacts, policy: SourcePolicy): string | undefined {
  const p = policy.admission;
  if (!p.sourceModels.includes(facts.model)) return 'unsupported-source-model';
  if (facts.byteLength > p.maxBytes) return 'encoded-size-limit';
  if (
    facts.width < 1 ||
    facts.height < 1 ||
    facts.width > p.maxAxis ||
    facts.height > p.maxAxis ||
    facts.width * facts.height > p.maxPixels
  )
    return 'geometry-limit';
  if (p.squareSize && (facts.width !== p.squareSize || facts.height !== p.squareSize))
    return 'noncanonical-picture';
  return undefined;
}
// Facts already use displayed dimensions. Compare integer cross-products and the
// configured decimal exactly so the inclusive boundary does not depend on rounding.
function similarAspectRatios(facts: readonly SourceFacts[], tolerance: number): boolean {
  const first = facts[0];
  if (!first) return true;
  let smallest = first,
    largest = first;
  for (const fact of facts) {
    if (BigInt(fact.width) * BigInt(smallest.height) < BigInt(smallest.width) * BigInt(fact.height))
      smallest = fact;
    if (BigInt(fact.width) * BigInt(largest.height) > BigInt(largest.width) * BigInt(fact.height))
      largest = fact;
  }
  const [decimal = '0', exponent = '0'] = tolerance.toString().split('e');
  const places = (decimal.split('.')[1]?.length ?? 0) - Number(exponent);
  const numerator = BigInt(decimal.replace('.', '')) * 10n ** BigInt(Math.max(0, -places));
  const denominator = 10n ** BigInt(Math.max(0, places));
  const upper = BigInt(largest.width) * BigInt(smallest.height);
  const lower = BigInt(smallest.width) * BigInt(largest.height);
  return (upper - lower) * denominator <= lower * numerator;
}
export function sourcesLayer(configuration: {
  readonly revision: string;
  readonly types: Readonly<Record<string, SourcePolicy>>;
  readonly readLifetimeMs?: number;
}) {
  const operations = resolveSourceOperations(configuration);
  return Layer.effect(
    Sources,
    Effect.gen(function* () {
      const store = yield* SourceStore;
      const storage = yield* SourceBytes;
      const inspection = yield* MandatoryInspection;
      const scope = yield* Effect.scope;
      const modify = (
        owner: Owner,
        assetId: string,
        revision: string | null,
        change: (state: SourceState) => SourceOutcome,
        context?: CommandContext,
        selection?: CandidateSelection
      ) =>
        store.transact<SourceOutcome>(
          assetId,
          revision,
          (state) => ({
            state,
            result: owns(owner, state) ? change(state) : unavailable,
            cleanupContext: context,
          }),
          selection
        );
      const candidate = (
        owner: Owner,
        assetId: string,
        id: string,
        change: (state: SourceState, candidate: Candidate) => SourceOutcome,
        revision: string | null = null,
        context?: CommandContext
      ) =>
        modify(
          owner,
          assetId,
          revision,
          (state) => {
            const found = state.candidates.find((c) => c.candidateId === id);
            if (!found) return unavailable;
            const wasPending = nonterminal(found);
            const outcome = change(state, found);
            if (wasPending && !nonterminal(found)) state.nonterminalCandidateCount--;
            return outcome;
          },
          context,
          { kind: 'candidate', candidateId: id }
        );
      const changeSource = Effect.fn('asset.sources.change')(function* (
        owner: Owner,
        assetId: string,
        sourceId: string,
        expectedRevision: string,
        operation: 'select-default' | 'withdraw',
        context?: CommandContext
      ) {
        if (!validRevision(expectedRevision))
          return { kind: 'rejected', reason: 'malformed-source-change' } as const;
        const now = yield* Clock.currentTimeMillis;
        return yield* store.transact<SourceChangeOutcome>(
          assetId,
          configuration.revision,
          (state) => {
            if (!owns(owner, state)) return { state, result: unavailable };
            const policy = configuration.types[state.asset.assetType];
            if (!policy || state.asset.assetType !== 'wallpaper')
              return { state, result: { kind: 'rejected', reason: 'unsupported-operation' } };
            if (state.sourceSetRevision !== expectedRevision)
              return { state, result: { kind: 'rejected', reason: 'source-set-conflict' } };
            if (!state.sources.some((source) => source.sourceId === sourceId))
              return { state, result: { kind: 'rejected', reason: 'unavailable-source' } };
            if (operation === 'withdraw') {
              if (state.sources.length === 1)
                return { state, result: { kind: 'rejected', reason: 'last-source-withdrawal' } };
              if (state.defaultSourceId === sourceId)
                return { state, result: { kind: 'rejected', reason: 'default-source-withdrawal' } };
              state.sources = state.sources.filter((source) => source.sourceId !== sourceId);
            } else if (state.defaultSourceId === sourceId) {
              return {
                state,
                result: {
                  kind: 'changed',
                  sourceSetRevision: state.sourceSetRevision,
                  deliveryRevision: state.deliveryRevision,
                  defaultSourceId: sourceId,
                },
              };
            } else state.defaultSourceId = sourceId;
            state.sourceSetRevision = (BigInt(state.sourceSetRevision) + 1n).toString();
            state.deliveryRevision = (BigInt(state.deliveryRevision) + 1n).toString();
            if (!state.defaultSourceId) throw new Error('Active Source set requires a Default');
            return {
              state,
              result: {
                kind: 'changed',
                sourceSetRevision: state.sourceSetRevision,
                deliveryRevision: state.deliveryRevision,
                defaultSourceId: state.defaultSourceId,
              },
              ...(operation === 'withdraw'
                ? {
                    cleanupContext: context,
                    retirement: {
                      sourceId,
                      evidenceExpiresAt: new Date(now + policy.retention.evidenceMs).toISOString(),
                    },
                  }
                : {}),
            };
          }
        );
      });
      return Sources.of({
        selectDefault: (owner, assetId, sourceId, revision) =>
          changeSource(owner, assetId, sourceId, revision, 'select-default'),
        withdraw: (owner, assetId, sourceId, revision, context) =>
          changeSource(owner, assetId, sourceId, revision, 'withdraw', context),
        policy: (owner, type) => {
          const selected = Object.hasOwn(configuration.types, type)
            ? configuration.types[type]
            : undefined;
          return Effect.succeed(
            validOwner(owner) && selected
              ? { kind: 'policy', policy: selected, revision: configuration.revision }
              : unavailable
          );
        },
        list: (owner, assetId, cursor) =>
          cursor !== undefined &&
          (typeof cursor !== 'string' || new TextEncoder().encode(cursor).length > 256)
            ? Effect.succeed(unavailable)
            : store.transact<Effect.Success<ReturnType<SourcesPort['list']>>>(
                assetId,
                null,
                (state) => {
                  if (!owns(owner, state)) return { state, result: unavailable };
                  if (!state.candidatePage?.valid) return { state, result: unavailable };
                  return {
                    state,
                    result: {
                      kind: 'found' as const,
                      asset: {
                        assetId,
                        assetType: state.asset.assetType,
                        sources: state.sources,
                        candidates: state.candidates,
                        hasPendingCandidates: state.nonterminalCandidateCount > 0,
                        ...(state.candidatePage.nextCursor
                          ? { nextCandidateCursor: state.candidatePage.nextCursor }
                          : {}),
                        defaultSourceId: state.defaultSourceId,
                        sourceSetRevision: state.sourceSetRevision,
                        deliveryRevision: state.deliveryRevision,
                      },
                    },
                  };
                },
                { kind: 'page', cursor }
              ),
        create: Effect.fn('asset.sources.create')(function* (owner, assetId, input) {
          if (
            !validRevision(input.expectedSourceSetRevision) ||
            typeof input.idempotencyKey !== 'string' ||
            !/^[\x21-\x7e]{1,128}$/.test(input.idempotencyKey) ||
            !['add', 'replace-one', 'replace-set'].includes(input.operation) ||
            (input.operation === 'replace-one') !==
              (typeof input.targetSourceId === 'string' && input.targetSourceId.length > 0)
          )
            return reject('malformed-candidate');
          const now = yield* Clock.currentTimeMillis;
          const candidateId = `candidate_${crypto.randomUUID()}`;
          const sourceId = `source_${crypto.randomUUID()}`;
          const context = input.context ?? {
            occurrence: { source: 'https://wallpaperdb/asset/authors', id: crypto.randomUUID() },
          };
          return yield* modify(
            owner,
            assetId,
            configuration.revision,
            (state) => {
              const old = state.candidates.find((c) => c.idempotencyKey === input.idempotencyKey);
              if (old) return sameIntent(old, input) ? result(old) : reject('idempotency-conflict');
              const policy = configuration.types[state.asset.assetType];
              if (!policy || !policy.operations.includes(input.operation))
                return reject('unsupported-operation');
              if (
                (input.operation === 'replace-set' && state.asset.assetType !== 'picture') ||
                (input.operation === 'replace-one' && state.asset.assetType === 'picture')
              )
                return reject('unsupported-operation');
              if (input.expectedSourceSetRevision !== state.sourceSetRevision)
                return reject('source-set-conflict');
              if (
                input.operation === 'replace-one' &&
                !state.sources.some((source) => source.sourceId === input.targetSourceId)
              )
                return reject('unavailable-source');
              if (
                (input.operation === 'replace-set'
                  ? 1
                  : state.sources.length + (input.operation === 'add' ? 1 : 0)) >
                policy.maxActiveSources
              )
                return reject('source-count-limit');
              if (
                state.candidates.filter(
                  (c) =>
                    !['accepted', 'rejected', 'cancelled'].includes(c.status) &&
                    Date.parse(c.expiresAt) > now
                ).length >= policy.maxCandidates
              )
                return reject('candidate-count-limit');
              const created: Candidate = {
                ...input,
                candidateId,
                sourceId,
                context,
                status: 'awaiting-bytes',
                expiresAt: new Date(now + policy.retention.candidateMs).toISOString(),
                orphanExpiresAt: new Date(now + policy.retention.candidateMs).toISOString(),
                temporaryExpiresAt: new Date(now + policy.temporaryInput.abandonedMs).toISOString(),
                layout: 'asset-layout-1',
              };
              state.candidates.push(created);
              state.nonterminalCandidateCount++;
              return result(created);
            },
            undefined,
            {
              kind: 'create',
              idempotencyKey: input.idempotencyKey,
              now,
              limit: Math.max(1, ...Object.values(configuration.types).map((p) => p.maxCandidates)),
            }
          );
        }),
        status: (owner, assetId, id) =>
          candidate(owner, assetId, id, (_state, found) => result(found)),
        cancel: (owner, assetId, id, context) =>
          candidate(
            owner,
            assetId,
            id,
            (_state, found) => {
              if (found.status === 'accepted') return reject('already-accepted');
              found.status = 'cancelled';
              return result(found);
            },
            null,
            context
          ),
        upload: Effect.fn('asset.sources.upload')(function* (owner, assetId, id, bytes, context) {
          const authorized = yield* candidate(owner, assetId, id, (_state, found) => result(found));
          if (authorized.kind !== 'candidate') return authorized;
          if (['cancelled', 'rejected'].includes(authorized.candidate.status)) return authorized;
          const selected = yield* store.transact(assetId, null, (state) => ({
            state,
            result: state ? configuration.types[state.asset.assetType] : undefined,
          }));
          if (!selected) return unavailable;
          const input = yield* Effect.tryPromise({
            try: async (signal) => {
              const chunks: Uint8Array[] = [];
              let size = 0;
              for await (const chunk of bytes) {
                if (signal.aborted) throw new Error('Upload cancelled');
                size += chunk.byteLength;
                if (size > selected.admission.maxBytes) return null;
                chunks.push(chunk);
              }
              const buffer = new Uint8Array(size);
              let offset = 0;
              for (const chunk of chunks) {
                buffer.set(chunk, offset);
                offset += chunk.length;
              }
              const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
              return {
                buffer,
                digest: Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join(''),
              };
            },
            catch: (cause) => new SourceFailure({ operation: 'receive-bytes', cause }),
          }).pipe(Effect.onInterrupt(() => Effect.sync(bytes.cancel)));
          if (!input) return reject('encoded-size-limit');
          const uploadedAt = yield* Clock.currentTimeMillis;
          const reserved = yield* candidate(
            owner,
            assetId,
            id,
            (_state, found) => {
              if (found.digest && found.digest !== input.digest)
                return reject('byte-digest-conflict');
              if (
                found.status === 'accepted' ||
                found.status === 'ready' ||
                found.status === 'cancelled' ||
                found.status === 'rejected'
              )
                return result(found);
              if (Date.parse(found.expiresAt) <= uploadedAt) {
                found.status = 'rejected';
                found.reason = 'candidate-expired';
                return result(found);
              }
              found.digest = input.digest;
              found.status = 'inspecting';
              return result(found);
            },
            null,
            context
          );
          if (reserved.kind !== 'candidate' || reserved.candidate.status !== 'inspecting')
            return reserved;
          yield* storage.put(id, input.buffer, input.digest);
          const inspected = yield* inspection.inspect(id, selected);
          return yield* candidate(
            owner,
            assetId,
            id,
            (_state, found) => {
              if (found.status !== 'inspecting') return result(found);
              const facts =
                inspected.kind === 'verified'
                  ? {
                      ...inspected.facts,
                      digest: input.digest,
                      byteLength: input.buffer.byteLength,
                    }
                  : undefined;
              const reason =
                inspected.kind === 'rejected'
                  ? inspected.reason
                  : facts
                    ? policyRejection(facts, selected)
                    : 'inspection-failed';
              if (reason) {
                found.status = 'rejected';
                found.reason = reason;
              } else {
                found.facts = facts;
                found.status = 'ready';
              }
              return result(found);
            },
            null,
            context
          );
        }),
        accept: Effect.fn('asset.sources.accept')(function* (owner, assetId, id, intent) {
          if (!validRevision(intent.expectedSourceSetRevision))
            return reject('malformed-candidate');
          const ready = yield* candidate(owner, assetId, id, (_state, found) =>
            sameIntent(found, intent) ? result(found) : reject('candidate-intent-conflict')
          );
          if (ready.kind !== 'candidate' || ready.candidate.status === 'accepted') return ready;
          const found = ready.candidate;
          if (found.status !== 'ready' || !found.facts) return reject('candidate-not-ready');
          yield* storage.prepare(id, found.sourceId, assetId, found.facts);
          const now = yield* Clock.currentTimeMillis;
          const context = intent.context ??
            found.context ?? {
              occurrence: { source: 'https://wallpaperdb/asset/authors', id: crypto.randomUUID() },
            };
          return yield* store.transact<SourceOutcome>(
            assetId,
            configuration.revision,
            (state) => {
              if (!owns(owner, state)) return { state, result: unavailable };
              const current = state.candidates.find((c) => c.candidateId === id);
              if (!current) return { state, result: unavailable };
              if (current.status === 'accepted') return { state, result: result(current) };
              if (current.status !== 'ready' || !current.facts)
                return { state, result: reject('candidate-not-ready') };
              const policy = configuration.types[state.asset.assetType];
              if (!policy) return { state, result: reject('unsupported-type') };
              if (!policy.operations.includes(current.operation))
                return { state, result: reject('unsupported-operation') };
              if (
                (current.operation === 'replace-set' && state.asset.assetType !== 'picture') ||
                (current.operation === 'replace-one' && state.asset.assetType === 'picture')
              )
                return { state, result: reject('unsupported-operation') };
              const reason =
                Date.parse(current.expiresAt) <= now
                  ? 'candidate-expired'
                  : (policyRejection(current.facts, policy) ??
                    (similarAspectRatios(
                      [...state.sources.map((s) => s.facts), current.facts],
                      policy.aspectRatioTolerance
                    )
                      ? undefined
                      : 'aspect-ratio-limit'));
              if (reason) {
                current.status = 'rejected';
                state.nonterminalCandidateCount--;
                current.reason = reason;
                return { state, result: result(current), cleanupContext: context };
              }
              if (state.sourceSetRevision !== intent.expectedSourceSetRevision)
                return { state, result: reject('source-set-conflict') };
              const replaced =
                current.operation === 'replace-one'
                  ? state.sources.find((source) => source.sourceId === current.targetSourceId)
                  : undefined;
              if (current.operation === 'replace-one' && !replaced)
                return { state, result: reject('unavailable-source') };
              const retired =
                current.operation === 'replace-set' ? state.sources : replaced ? [replaced] : [];
              if (state.sources.length - retired.length + 1 > policy.maxActiveSources)
                return { state, result: reject('source-count-limit') };
              if (retired.length > 0) {
                state.sources = state.sources.filter(
                  (source) => !retired.some((prior) => prior.sourceId === source.sourceId)
                );
                if (retired.some((prior) => prior.sourceId === state.defaultSourceId))
                  state.defaultSourceId = current.sourceId;
              }
              state.sources.push({
                sourceId: current.sourceId,
                facts: current.facts,
                layout: current.layout,
              });
              state.defaultSourceId ??= current.sourceId;
              state.initialAnalysisSourceId ??= current.sourceId;
              state.sourceSetRevision = (BigInt(state.sourceSetRevision) + 1n).toString();
              state.deliveryRevision = (BigInt(state.deliveryRevision) + 1n).toString();
              current.status = 'accepted';
              state.nonterminalCandidateCount--;
              current.sourceSetRevision = state.sourceSetRevision;
              return {
                state,
                result: result(current),
                cleanupContext: context,
                ...(retired.length > 0
                  ? {
                      retirements: retired.map((source) => ({
                        sourceId: source.sourceId,
                        evidenceExpiresAt: new Date(
                          now + policy.retention.evidenceMs
                        ).toISOString(),
                      })),
                    }
                  : {}),
                confirmation: {
                  context,
                  id: `source-accepted:${current.sourceId}`,
                  applicationId: state.asset.applicationId,
                  assetId,
                  assetType: state.asset.assetType,
                  candidateId: id,
                  sourceId: current.sourceId,
                  defaultSourceId: state.defaultSourceId,
                  initialAnalysisSourceId: state.initialAnalysisSourceId,
                  sourceSetRevision: state.sourceSetRevision,
                  deliveryRevision: state.deliveryRevision,
                },
              };
            },
            { kind: 'candidate', candidateId: id }
          );
        }),
        original: Effect.fn('asset.sources.original')(function* (owner, assetId, sourceId) {
          const readId = crypto.randomUUID();
          const lifetimeMs = operations.readLifetimeMs;
          const startedAt = yield* Clock.currentTimeMillis;
          const facts = yield* store.transact(assetId, null, (state) => {
            const facts = owns(owner, state)
              ? state.sources.find((s) => s.sourceId === sourceId)?.facts
              : undefined;
            return {
              state,
              result: facts,
              ...(facts
                ? {
                    readProtection: {
                      readId,
                      sourceId,
                      expiresAt: new Date(startedAt + lifetimeMs).toISOString(),
                    },
                  }
                : {}),
            };
          });
          if (!facts) return unavailable;
          const release = store.releaseRead(readId).pipe(
            Effect.catch((error) =>
              Effect.logError('Read protection release remains bounded by its recorded expiry', {
                operation: error.operation,
              })
            )
          );
          const elapsed = (yield* Clock.currentTimeMillis) - startedAt;
          if (elapsed >= lifetimeMs) {
            yield* release;
            return unavailable;
          }
          const opened = yield* storage
            .read(sourceId, assetId, Math.min(lifetimeMs, lifetimeMs - elapsed))
            .pipe(Effect.onError(() => release));
          if ((yield* Clock.currentTimeMillis) >= startedAt + lifetimeMs) {
            yield* opened.close().pipe(Effect.ensuring(release));
            return unavailable;
          }
          yield* opened.closed.pipe(Effect.ensuring(release), Effect.forkIn(scope));
          return {
            kind: 'original' as const,
            facts,
            bytes: opened.bytes,
            close: () => opened.close().pipe(Effect.ensuring(release)),
          };
        }),
      });
    })
  );
}
