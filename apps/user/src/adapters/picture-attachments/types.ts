import type { Effect } from 'effect';
import type { AttachmentFailure } from '../../capabilities/picture-attachments/index.js';
import type { Database } from '../database/index.js';
export type AttachmentDatabase = Parameters<Parameters<Database['run']>[0]>[0];
export type AttachmentQuery = <A>(
  operation: string,
  run: (db: AttachmentDatabase) => Promise<A>
) => Effect.Effect<A, AttachmentFailure>;
