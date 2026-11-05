import type { ReactNode } from 'react';
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  let safe = false;
  try {
    const url = new URL(href);
    safe =
      (url.protocol === 'https:' &&
        url.hostname === 'github.com' &&
        !url.username &&
        !url.password) ||
      (url.protocol === 't3-thread:' && url.hostname === 'v1');
  } catch {
    /* Unknown facts stay text. */
  }
  return safe ? <a href={href}>{children}</a> : <span>{children} (link unavailable)</span>;
}
export function Issues({ numbers }: { numbers: readonly number[] }) {
  return numbers.length ? (
    <>
      {numbers.map((number, index) => (
        <span key={number}>
          {index ? ', ' : ''}
          <ExternalLink href={`https://github.com/rafaeltab/wallpaperdb/issues/${number}`}>
            #{number}
          </ExternalLink>
        </span>
      ))}
    </>
  ) : (
    <>None</>
  );
}
