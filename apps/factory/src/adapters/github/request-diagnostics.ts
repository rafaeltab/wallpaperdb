export type RequestDiagnostic =
  | 'rate-limit'
  | 'authentication'
  | 'dns'
  | 'tls'
  | 'connection'
  | 'permissions'
  | 'not-found'
  | 'graphql-schema'
  | 'graphql';

const patterns: ReadonlyArray<readonly [RequestDiagnostic, RegExp]> = [
  ['rate-limit', /\bRATE_LIMITED\b|secondary rate limit|abuse detection/i],
  [
    'authentication',
    /gh auth login|not logged in|bad credentials|authentication failed|HTTP 401|requires authentication/i,
  ],
  [
    'dns',
    /no such host|\bENOTFOUND\b|\bEAI_AGAIN\b|(?:could not|unable to) resolve (?:host|hostname)/i,
  ],
  ['tls', /\bx509\b|\btls\b|SSL certificate|certificate signed by unknown authority/i],
  [
    'connection',
    /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)\b|connection (?:refused|reset|timed out)|(?:failed|unable|error) (?:to connect|connecting)/i,
  ],
  [
    'permissions',
    /\bFORBIDDEN\b|\bINSUFFICIENT_SCOPES\b|resource not accessible|insufficient (?:scope|permission)|missing required scope/i,
  ],
  ['not-found', /\bNOT_FOUND\b|could not resolve to|not found/i],
  [
    'graphql-schema',
    /GRAPHQL_VALIDATION_FAILED|undefinedField|unknownArgument|doesn't exist on type|cannot query field|unknown argument/i,
  ],
];

function classify(text: string): RequestDiagnostic | undefined {
  return patterns.find(([, pattern]) => pattern.test(text))?.[0];
}

/** Retain only a finite category; raw provider text may contain credentials or query data. */
export function cliDiagnostic(text: string): RequestDiagnostic | undefined {
  const line = text.trim();
  if (
    !/^(?:gh:|error(?:\s|:)|(?:Post|Get|Put|Patch|Delete|Head) "|dial |lookup |tls:|x509:|To get started with GitHub CLI)/i.test(
      line
    )
  )
    return;
  return classify(line) ?? (/^gh: GraphQL:/i.test(line) ? 'graphql' : undefined);
}

export function graphqlDiagnostic(error: { type?: string; message?: string }): RequestDiagnostic {
  return (
    classify(`${error.type?.slice(0, 128) ?? ''} ${error.message?.slice(0, 2048) ?? ''}`) ??
    'graphql'
  );
}
