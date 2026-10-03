export interface AliasCommand {
  action: 'schedule' | 'expire' | 'reactivate' | 'keep';
  handle: string;
  expectedVersion: number;
}
