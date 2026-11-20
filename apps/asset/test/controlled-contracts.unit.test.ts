import { controlledBytes } from './fixtures/controlled-bytes.js';
import { sourceBytesContract } from './contracts/source-bytes.js';
sourceBytesContract(async () => ({ port: controlledBytes(), close: async () => {} }));
import { controlledLifecycle } from './fixtures/controlled-lifecycle.js';
import { lifecycleStoreContract } from './contracts/lifecycle-store.js';
lifecycleStoreContract(async () => ({
  ...controlledLifecycle(),
  close: async () => {},
}));
import { controlledSources } from './fixtures/controlled-sources.js';
import { sourceStoreContract, contractSourceState } from './contracts/source-store.js';
sourceStoreContract(async () => {
  let revision = 'revision-1';
  return {
    port: controlledSources(contractSourceState, () => revision).port,
    activate: async (next) => {
      revision = next;
    },
    close: async () => {},
  };
});
