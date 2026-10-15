export interface AliasCommand {
  action: 'schedule' | 'expire' | 'reactivate' | 'keep';
  handle: string;
  expectedVersion: number;
}

/** Live shared command availability, without copying request state into an editor. */
export interface ProfileCommandAvailability {
  isBusy: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

/** Identity changes when the saved owner query is removed or recreated. */
export interface ProfileQueryOwnership {
  getIdentity: () => object | undefined;
  subscribe: (listener: () => void) => () => void;
}
