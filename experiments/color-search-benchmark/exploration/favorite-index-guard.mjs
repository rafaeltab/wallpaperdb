// Opt-in admission guard for throwaway indexing experiments. This observes the
// host filesystem only; it cannot reserve space against other writers/merges.
import { statfs, lstat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

export function createFavoriteIndexGuard(config, dependencies = {}) {
  const inspectDisk = dependencies.statfs ?? statfs, inspectStop = dependencies.lstat ?? lstat;
  const now = dependencies.now ?? (() => performance.now());
  const enabled = config.diskPath !== undefined || config.stopFile !== undefined;
  const state = { enabled, intervalMs: 2000, checks: 0, lastCheck: null, failure: null,
    ...(config.diskPath === undefined ? {} : { diskPath: config.diskPath, minimumFreeBytes: config.minimumFreeBytes }),
    ...(config.stopFile === undefined ? {} : { stopFile: config.stopFile }) };
  let checkedAt, failure;
  const snapshot = () => structuredClone(state);
  const stop = (reason, message, detail = {}, cause) => {
    state.failure = { at: new Date().toISOString(), reason, ...detail };
    failure = new Error(message, cause ? { cause } : undefined);
    failure.indexGuardEvidence = snapshot();
    throw failure;
  };
  async function check({ force = false } = {}) {
    if (failure) throw failure;
    if (!enabled) return;
    const at = now();
    if (!force && checkedAt !== undefined && at - checkedAt < state.intervalMs) return;
    checkedAt = at; state.checks++;
    const observation = { at: new Date().toISOString() };
    state.lastCheck = observation;
    try {
      if (config.stopFile !== undefined) {
        let exists = true;
        try { await inspectStop(config.stopFile); }
        catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
        observation.stopFilePresent = exists;
        if (exists) stop('stop-file', 'Indexing stopped: STOP file exists at ' + config.stopFile);
      }
      if (config.diskPath !== undefined) {
        const stats = await inspectDisk(config.diskPath, { bigint: true });
        if (typeof stats.bavail !== 'bigint' || typeof stats.bsize !== 'bigint' || stats.bavail < 0n || stats.bsize <= 0n) {
          throw Error('Filesystem returned invalid available blocks or block size.');
        }
        const available = stats.bavail * stats.bsize;
        observation.availableBytes = String(available);
        if (available < BigInt(config.minimumFreeBytes)) {
          stop('disk-reserve', `Indexing stopped: disk reserve requires ${config.minimumFreeBytes} available bytes at ${config.diskPath}; observed ${available}.`,
            { availableBytes: String(available), minimumFreeBytes: config.minimumFreeBytes });
        }
      }
    } catch (error) {
      if (error === failure) throw error;
      stop('inspection-failed', 'Indexing guard could not inspect its filesystem: ' + error.message,
        { error: String(error.stack ?? error) }, error);
    }
  }
  return { enabled, check, snapshot };
}
