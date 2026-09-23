import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { Ingestion } from '../src/ingestion/index.js';
import { fixture, uploadInput } from './helpers/ingestion.js';

describe('Wallpaper ingestion', () => {
  it('durably accepts an inspected wallpaper and publishes its committed snapshot', async () => {
    const test = fixture();
    const result = await Effect.runPromise(Ingestion.use((ingestion) => ingestion.upload(uploadInput)).pipe(Effect.provide(test.layer)));
    expect(result._tag).toBe('Accepted');
    if (result._tag !== 'Accepted') throw new Error('Expected accepted upload');
    expect(test.objects).toEqual([{ wallpaperId: result.upload.id, extension: 'png' }]);
    expect(test.published).toHaveLength(1);
    expect(test.published[0]?.wallpaper).toMatchObject({ id: result.upload.id, profileId: 'profile-1', originalFilename: '.._wallpaper.png' });
    expect(test.store.records.get(result.upload.id)?.state).toBe('processing');
    expect(test.store.outbox.size).toBe(0);
  });
});
