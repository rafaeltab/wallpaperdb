import { DatabaseConnection as CoreDatabaseConnection } from '@wallpaperdb/core/connections';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';

const schema = {} as const;

export type DatabaseClient = ReturnType<CoreDatabaseConnection<typeof schema>['getClient']>;

@singleton()
export class DatabaseConnection extends CoreDatabaseConnection<typeof schema> {
  constructor(@inject('config') config: Config) {
    super(config, schema);
  }
}
