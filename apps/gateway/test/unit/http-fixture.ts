import { Effect } from 'effect';
import type { Catalogue } from '../../src/catalogue/index.js';
import type { HttpConfig } from '../../src/http/index.js';
export const httpConfig: HttpConfig = {
  port: 3004,
  nodeEnv: 'test',
  mediaServiceUrl: 'http://media.example.com',
  mediaPublicPath: '/media',
  graphqlMaxDepth: 5,
  graphqlMaxComplexity: 1000,
  graphqlMaxUniqueFields: 50,
  graphqlMaxAliases: 20,
  graphqlMaxBatchSize: 10,
  graphqlIntrospectionEnabled: true,
  rateLimitMaxAnonymous: 100,
};
export class EmptyCatalogue implements Catalogue {
  search() {
    return Effect.succeed({
      _tag: 'Found',
      value: {
        wallpapers: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: null,
          endCursor: null,
        },
      },
    } satisfies Awaited<Effect.Effect.Success<ReturnType<Catalogue['search']>>>);
  }
  wallpaper() {
    return Effect.succeed({ _tag: 'Found', value: null } satisfies Effect.Effect.Success<
      ReturnType<Catalogue['wallpaper']>
    >);
  }
  profile() {
    return this.wallpaper();
  }
  profileByHandle() {
    return this.wallpaper();
  }
  profiles(ids: string[]) {
    return Effect.succeed({
      _tag: 'Found',
      value: ids.map(() => null),
    } satisfies Effect.Effect.Success<ReturnType<Catalogue['profiles']>>);
  }
}
