import { Effect, Layer } from 'effect';
import { Admission, admissionLayer } from '../../src/admission/index.js';
import {
  Availability,
  AvailabilityProbe,
  availabilityLayer,
} from '../../src/availability/index.js';
import { memoryQuotaLayer } from '../helpers/quota.js';
import { Catalogue } from '../../src/catalogue/index.js';
import { createHttpApp, type HttpConfig } from '../../src/http/index.js';

export interface HttpTestServices {
  readonly catalogue: Catalogue;
  readonly admission: Admission;
  readonly availability: Availability;
}
export const httpConfig: HttpConfig = {
  port: 3004,
  nodeEnv: 'test',
  mediaServiceUrl: 'http://media.example.com',
  mediaPublicPath: '/media',
  graphqlMaxDepth: 5,
  graphqlMaxComplexity: 2000,
  graphqlMaxUniqueFields: 50,
  graphqlMaxAliases: 20,
  graphqlMaxBatchSize: 10,
  graphqlIntrospectionEnabled: true,
  rateLimitMaxAnonymous: 100,
};
export class EmptyCatalogue implements Catalogue {
  searchProfiles() {
    return Effect.succeed({
      _tag: 'Found',
      value: {
        profiles: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: null,
          endCursor: null,
        },
      },
    } satisfies Effect.Success<ReturnType<Catalogue['searchProfiles']>>);
  }
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
    } satisfies Awaited<Effect.Success<ReturnType<Catalogue['search']>>>);
  }
  wallpaper() {
    return Effect.succeed(null);
  }
  profile() {
    return this.wallpaper();
  }
  profileByHandle() {
    return this.wallpaper();
  }
  profiles(ids: string[]) {
    return Effect.succeed(ids.map(() => null));
  }
}

export function httpTestLayer(
  config: HttpConfig = httpConfig,
  ports: Partial<HttpTestServices> = {}
) {
  return Layer.mergeAll(
    Layer.succeed(Catalogue, ports.catalogue ?? new EmptyCatalogue()),
    ports.admission
      ? Layer.succeed(Admission, ports.admission)
      : admissionLayer({
          enabled: true,
          limit: config.rateLimitMaxAnonymous,
          windowMs: 60000,
        }).pipe(Layer.provide(memoryQuotaLayer)),
    ports.availability
      ? Layer.succeed(Availability, ports.availability)
      : availabilityLayer.pipe(
          Layer.provide(
            Layer.succeed(AvailabilityProbe, {
              inspect: () => Effect.succeed({ nats: true, opensearch: true, otel: true }),
            })
          )
        )
  );
}
export function createTestHttpApp(
  config: HttpConfig = httpConfig,
  ports: Partial<HttpTestServices> = {}
) {
  return createHttpApp(config, httpTestLayer(config, ports));
}
