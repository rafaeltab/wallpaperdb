import { controlledStore } from './fixtures/store.js';
import { storeContract } from './fixtures/store-contract.js';
storeContract('controlled store', async () => {
  const store = controlledStore();
  return { store, reopen: () => store, close: async () => {} };
});
