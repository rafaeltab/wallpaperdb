import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ThreadLinks, ExternalLink } from '../src/links';
it('constructs supported external links with separately encoded identities and explicit Connect opt-in', () => {
  const html = renderToStaticMarkup(
    <ThreadLinks environmentId="env /é" threadId="mcp:a/b%" browserOrigin="https://app.t3.codes" />
  );
  expect(html).toContain('t3code://threads/env%20%2F%C3%A9/mcp%3Aa%2Fb%25');
  expect(html).toContain('https://app.t3.codes/env%20%2F%C3%A9/mcp%3Aa%2Fb%25');
  expect(html).not.toContain('t3-thread:');
});
it('reports incomplete identity and unconfigured or unsafe Connect honestly', () => {
  expect(renderToStaticMarkup(<ThreadLinks threadId="t" />)).toContain('identity unknown');
  for (const browserOrigin of [
    undefined,
    'https://user:secret@app.t3.codes',
    'javascript:bad',
    'https://app.t3.codes/path',
  ]) {
    const html = renderToStaticMarkup(
      <ThreadLinks environmentId="e" threadId="t" browserOrigin={browserOrigin} />
    );
    expect(html).toContain('t3code://threads/e/t');
    expect(html).toContain('Browser link unavailable');
    expect(html).not.toContain('secret');
  }
  expect(
    renderToStaticMarkup(<ExternalLink href="t3-thread://v1/t">Thread</ExternalLink>)
  ).not.toContain('<a');
});
