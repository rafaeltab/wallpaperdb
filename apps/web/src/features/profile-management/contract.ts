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
