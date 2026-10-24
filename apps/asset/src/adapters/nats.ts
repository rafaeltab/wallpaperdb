import type { ConnectionOptions } from 'nats';

/** Asset's URL-selected transport. The installed NATS client discards schemes,
 * so TLS selection must also reach its explicit transport option. Empty TLS
 * options retain the client's default certificate and hostname verification. */
export function assetBrokerTransport(url: string): Pick<ConnectionOptions, 'servers' | 'tls'> {
  return {
    servers: url,
    ...(url.trimStart().toLowerCase().startsWith('tls://') ? { tls: {} } : {}),
  };
}
