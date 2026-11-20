import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import type { SourceBytesPort } from '../../src/capabilities/sources/index.js';
export function sourceBytesContract(
  open: () => Promise<{ port: SourceBytesPort; close: () => Promise<unknown> }>
) {
  it('preserves immutable replay, rejects changed identities and verifies supplied digests', async () => {
    const f = await open();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const changed = new Uint8Array([4, 3, 2, 1]);
    const facts = {
      width: 2,
      height: 2,
      model: 'sdr-png',
      mimeType: 'image/png',
      byteLength: 4,
      digest,
    };
    try {
      await Effect.runPromise(f.port.put('candidate', bytes, digest));
      await Effect.runPromise(f.port.put('candidate', bytes, digest));
      await expect(
        Effect.runPromise(
          f.port.put('candidate', changed, createHash('sha256').update(changed).digest('hex'))
        )
      ).rejects.toThrow();
      await expect(Effect.runPromise(f.port.put('bad-digest', changed, digest))).rejects.toThrow();
      await Effect.runPromise(f.port.prepare('candidate', 'source', 'asset', facts));
      await Effect.runPromise(f.port.prepare('candidate', 'source', 'asset', facts));
      await expect(
        Effect.runPromise(
          f.port.prepare('candidate', 'bad-source', 'asset', { ...facts, digest: '0'.repeat(64) })
        )
      ).rejects.toThrow();
      await Effect.runPromise(
        f.port.put('other', changed, createHash('sha256').update(changed).digest('hex'))
      );
      await expect(
        Effect.runPromise(
          f.port.prepare('other', 'source', 'asset', {
            ...facts,
            digest: createHash('sha256').update(changed).digest('hex'),
          })
        )
      ).rejects.toThrow();
      await expect(Effect.runPromise(f.port.read('source', 'other-asset'))).rejects.toThrow();
      const read = await Effect.runPromise(f.port.read('source', 'asset'));
      try {
        const chunks: number[] = [];
        for await (const chunk of read.bytes) chunks.push(...chunk);
        expect(chunks).toEqual([1, 2, 3, 4]);
      } finally {
        await Effect.runPromise(read.close());
      }
    } finally {
      await f.close();
    }
  });
}
