import type { ReactNode } from 'react';
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  let safe = false;
  try {
    const url = new URL(href);
    safe =
      url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password;
  } catch {
    /* Unknown facts stay text. */
  }
  return safe ? <a href={href}>{children}</a> : <span>{children} (link unavailable)</span>;
}
export function Issues({ numbers }: { numbers: readonly number[] }) {
  return numbers.length ? (
    numbers.map((number, index) => (
      <span key={number}>
        {index ? ', ' : ''}
        <ExternalLink href={`https://github.com/rafaeltab/wallpaperdb/issues/${number}`}>
          #{number}
        </ExternalLink>
      </span>
    ))
  ) : (
    <>None</>
  );
}

export function ThreadLinks({
  threadId,
  environmentId,
  browserOrigin,
}: {
  threadId: string;
  environmentId?: string;
  browserOrigin?: string;
}) {
  if (!environmentId?.trim() || !threadId.trim())
    return <span>T3 links unavailable. Environment or thread identity unknown.</span>;
  const path = `${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
  let browser: string | undefined;
  if (browserOrigin) {
    try {
      const origin = new URL(browserOrigin);
      if (
        origin.protocol === 'https:' &&
        !origin.username &&
        !origin.password &&
        origin.pathname === '/' &&
        !origin.search &&
        !origin.hash
      )
        browser = `${origin.origin}/${path}`;
    } catch {
      /* Unavailable Connect configuration. */
    }
  }
  return (
    <>
      <a href={`t3code://threads/${path}`}>Open in T3 app</a>{' '}
      {browser ? (
        <a href={browser} target="_blank" rel="noreferrer">
          Open in browser
        </a>
      ) : (
        <span>Browser link unavailable. Connect is not configured.</span>
      )}
    </>
  );
}
