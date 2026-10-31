import dns from 'node:dns';
import { vi } from 'vitest';

/** Two DNS answers for the same owned endpoint force address fallback deterministically. */
export async function withBrokerAddresses<A>(
  address: string,
  run: (hostname: string) => Promise<A>
): Promise<A> {
  const hostname = 'broker-acquisition.invalid';
  const resolve4 = dns.resolve4;
  const resolve6 = dns.resolve6;
  const ipv4 = vi.spyOn(dns, 'resolve4').mockImplementation((...args: unknown[]) => {
    if (args[0] !== hostname) return Reflect.apply(resolve4, dns, args);
    const callback = args[1];
    if (typeof callback !== 'function') throw new Error('Expected callback DNS resolution');
    callback(null, [address, address]);
  });
  const ipv6 = vi.spyOn(dns, 'resolve6').mockImplementation((...args: unknown[]) => {
    if (args[0] !== hostname) return Reflect.apply(resolve6, dns, args);
    const callback = args[1];
    if (typeof callback !== 'function') throw new Error('Expected callback DNS resolution');
    callback(null, []);
  });
  try {
    return await run(hostname);
  } finally {
    ipv4.mockRestore();
    ipv6.mockRestore();
  }
}
