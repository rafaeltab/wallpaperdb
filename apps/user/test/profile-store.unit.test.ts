import { describe } from 'vitest';
import { profileStoreContract } from './contracts/profile-store.js';
import { controlledProfiles } from './helpers/profiles.js';

describe('controlled ProfileStore contract', () => {
  profileStoreContract(() => {
    const controlled = controlledProfiles();
    return {
      store: controlled.store,
      occurrences: async () => controlled.transitions.length,
    };
  });
});
