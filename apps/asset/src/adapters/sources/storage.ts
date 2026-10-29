import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Context, Effect, Layer } from 'effect';
import { z } from 'zod';
import { CleanupBytes, CleanupFailure } from '../../capabilities/cleanup/index.js';
import { observeCleanup } from '../cleanup/index.js';
import {
  SourceBytes,
  MandatoryInspection,
  SourceFailure,
  type SourceBytesPort,
  type SourceFacts,
  type MandatoryInspectionPort,
  resolveSourceOperations,
} from '../../capabilities/sources/index.js';
const factsSchema = z.object({
  model: z.string(),
  mimeType: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: z.number().int().positive(),
  hasAlpha: z.boolean().optional(),
  orientation: z.number().int().min(1).max(8).optional(),
  animation: z
    .object({
      frames: z.number().int().min(2),
      loop: z.number().int().min(0).max(65535),
      delaysMs: z.array(z.number().int().min(0).max(16777215)),
    })
    .optional(),
});
interface Options {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly reclamationTimeoutMs?: number;
}
const candidateKey = (id: string) => `asset-layout-1/private/candidates/${id}/input`;
const sourceKey = (asset: string, source: string) =>
  `asset-layout-1/assets/${asset}/sources/${source}/original`;
export function sourceStorageLayer(options: Options) {
  const operations = resolveSourceOperations(options);
  return Layer.effectContext(
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new S3Client({
              endpoint: options.endpoint,
              region: options.region,
              forcePathStyle: true,
              credentials: {
                accessKeyId: options.accessKeyId,
                secretAccessKey: options.secretAccessKey,
              },
            })
        ),
        (client) => Effect.sync(() => client.destroy())
      );
      const streams = new Set<Readable>();
      const workers = new Set<{ readonly kill: () => void; readonly closed: Promise<void> }>();
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          for (const stream of streams) stream.destroy();
          for (const worker of workers) worker.kill();
          await Promise.all([...workers].map((w) => w.closed));
        })
      );
      const run = <A>(operation: string, work: (signal: AbortSignal) => Promise<A>) =>
        Effect.tryPromise({
          try: work,
          catch: (cause) => new SourceFailure({ operation, cause }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError('Source storage operation failed', { operation, cause: error.cause })
          ),
          Effect.withSpan(`asset.sources.storage.${operation}`)
        );
      async function immutablePut(
        key: string,
        bytes: Uint8Array,
        digest: string,
        signal: AbortSignal
      ) {
        if (createHash('sha256').update(bytes).digest('hex') !== digest)
          throw new Error('Digest mismatch');
        try {
          await client.send(
            new PutObjectCommand({
              Bucket: options.bucket,
              Key: key,
              Body: bytes,
              IfNoneMatch: '*',
              Metadata: { sha256: digest },
              ContentLength: bytes.byteLength,
            }),
            { abortSignal: signal }
          );
        } catch (cause) {
          // Lost success and concurrent conditional writes reconcile against authoritative metadata.
          const head = await client
            .send(new HeadObjectCommand({ Bucket: options.bucket, Key: key }), {
              abortSignal: signal,
            })
            .catch(() => null);
          if (head?.Metadata?.sha256 !== digest || head.ContentLength !== bytes.byteLength)
            throw cause;
        }
      }
      async function get(key: string, signal: AbortSignal) {
        const object = await client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: key }),
          { abortSignal: signal }
        );
        if (!(object.Body instanceof Readable)) throw new Error('Unavailable Source body');
        const body = object.Body;
        if (object.Metadata?.reclaimed === 'true') {
          body.destroy();
          throw new Error('Reclaimed Source bytes');
        }
        streams.add(body);
        body.once('close', () => streams.delete(body));
        return body;
      }
      const storage: SourceBytesPort = {
        put: (id, bytes, digest) =>
          run('put-candidate', (signal) => immutablePut(candidateKey(id), bytes, digest, signal)),
        prepare: (candidateId, sourceId, assetId, facts) =>
          run('prepare-original', async (signal) => {
            const body = await get(candidateKey(candidateId), signal);
            const chunks: Buffer[] = [];
            let size = 0;
            try {
              for await (const chunk of body) {
                size += chunk.length;
                if (size > facts.byteLength) throw new Error('Candidate size changed');
                chunks.push(Buffer.from(chunk));
              }
              const bytes = Buffer.concat(chunks);
              if (size !== facts.byteLength) throw new Error('Candidate size changed');
              await immutablePut(sourceKey(assetId, sourceId), bytes, facts.digest, signal);
            } finally {
              body.destroy();
            }
          }),
        read: (sourceId, assetId, lifetimeMs = operations.readLifetimeMs) =>
          run('read-original', async (signal) => {
            const deadline = Date.now() + lifetimeMs;
            const body = await get(
              sourceKey(assetId, sourceId),
              AbortSignal.any([signal, AbortSignal.timeout(lifetimeMs)])
            );
            const timer = setTimeout(
              () => body.destroy(new Error('Source read lifetime elapsed')),
              Math.max(1, deadline - Date.now())
            );
            timer.unref();
            body.on('error', () => undefined);
            const closed = new Promise<void>((resolve) => {
              body.once('close', () => {
                clearTimeout(timer);
                resolve();
              });
            });
            return {
              bytes: body,
              closed: Effect.promise(() => closed),
              close: () =>
                Effect.sync(() => {
                  body.destroy();
                  streams.delete(body);
                }),
            };
          }),
      };
      const inspection: MandatoryInspectionPort = {
        inspect: (id, policy) =>
          run('inspect-mandatory', async (signal) => {
            // This admission-only worker is killed and reaped on cancellation/shutdown.
            const body = await get(candidateKey(id), signal);
            const path = fileURLToPath(
              new URL(
                import.meta.url.endsWith('.ts') ? './inspect-worker.ts' : './inspect-worker.mjs',
                import.meta.url
              )
            );
            const child = spawn(
              process.execPath,
              [
                ...(path.endsWith('.ts') ? ['--import', 'tsx'] : []),
                path,
                JSON.stringify(policy.admission),
              ],
              { stdio: ['pipe', 'pipe', 'pipe'] }
            );
            let resolveClosed!: () => void;
            const closed = new Promise<void>((resolve) => {
              resolveClosed = resolve;
            });
            const worker = {
              kill: () => {
                body.destroy();
                child.kill('SIGKILL');
              },
              closed,
            };
            workers.add(worker);
            const abort = () => worker.kill();
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
            const output: Buffer[] = [];
            // A WebP ANMF chunk needs at least 24 encoded bytes before any frame data.
            // Each permitted delay needs at most eight decimal digits and a separator.
            // Reserve 1 KiB for the fixed facts envelope. Derive the transport bound
            // from the effective encoded-input policy rather than imposing a frame quota.
            const maxFactsBytes = 1024 + Math.floor(policy.admission.maxBytes / 24) * 9;
            let size = 0;
            child.stdout.on('data', (chunk) => {
              size += chunk.length;
              if (size > maxFactsBytes) worker.kill();
              else output.push(chunk);
            });
            // Diagnostics never include arbitrary input bytes.
            child.stderr.resume();
            const exited = new Promise<number | null>((resolve, reject) => {
              child.once('error', reject);
              child.once('close', (code) => {
                workers.delete(worker);
                resolveClosed();
                resolve(code);
              });
            });
            try {
              const [, code] = await Promise.all([pipeline(body, child.stdin), exited]);
              if (code !== 0 || signal.aborted) throw new Error('Inspection interrupted');
              const parsed: unknown = JSON.parse(Buffer.concat(output).toString('utf8'));
              const rejected = z
                .object({
                  rejected: z.enum([
                    'unsupported-source-model',
                    'encoded-size-limit',
                    'noncanonical-picture',
                    'geometry-limit',
                    'invalid-image',
                  ]),
                })
                .safeParse(parsed);
              if (rejected.success)
                return { kind: 'rejected' as const, reason: rejected.data.rejected };
              const facts: SourceFacts = factsSchema.parse(parsed);
              return { kind: 'verified' as const, facts };
            } finally {
              signal.removeEventListener('abort', abort);
              worker.kill();
              await closed;
            }
          }),
      };
      return Context.make(SourceBytes, storage).pipe(
        Context.add(MandatoryInspection, inspection),
        Context.add(CleanupBytes, {
          reclaim: (target, work) => {
            const reclamation = run('reclaim', async (signal) => {
              const deadline = AbortSignal.any([
                signal,
                AbortSignal.timeout(operations.reclamationTimeoutMs),
              ]);
              const keys =
                target.kind === 'candidate'
                  ? [
                      candidateKey(target.candidateId),
                      `asset-layout-1/private/candidates/${target.candidateId}/canonical`,
                    ]
                  : [sourceKey(target.assetId, target.sourceId)];
              // Atomic replacement leaves no gap for a delayed conditional writer.
              // Empty fences survive metadata purge because identities are never reused.
              for (const key of keys) {
                try {
                  await client.send(
                    new PutObjectCommand({
                      Bucket: options.bucket,
                      Key: key,
                      Body: new Uint8Array(),
                      ContentLength: 0,
                      Metadata: { reclaimed: 'true' },
                    }),
                    { abortSignal: deadline }
                  );
                } catch (cause) {
                  const head = await client
                    .send(
                      new HeadObjectCommand({
                        Bucket: options.bucket,
                        Key: key,
                      }),
                      { abortSignal: deadline }
                    )
                    .catch(() => null);
                  if (head?.Metadata?.reclaimed !== 'true' || head.ContentLength !== 0) throw cause;
                }
              }
            }).pipe(
              Effect.mapError(
                (error) =>
                  new CleanupFailure({
                    operation: error.operation,
                    cause: error.cause,
                  })
              )
            );
            return work
              ? observeCleanup(
                  'asset.cleanup.reclaim-bytes',
                  work,
                  reclamation.pipe(Effect.as('reclaimed'))
                ).pipe(Effect.asVoid)
              : reclamation;
          },
        })
      );
    })
  );
}
