import { headers, type MsgHdrs } from 'nats';

export interface EnvelopeConformanceCase {
  readonly name: string;
  readonly payload: Uint8Array;
  readonly metadata?: MsgHdrs;
  readonly accepted: boolean;
  readonly expected?: {
    readonly source: string;
    readonly id: string;
    readonly correlationId?: string;
    readonly causationId?: string;
    readonly causationSource?: string;
  };
}

/** Transport invariants shared by consumers; domain interpretation remains application-owned. */
export function uploadEnvelopeConformance(): readonly EnvelopeConformanceCase[] {
  const time = '2026-01-01T00:00:00.000Z';
  const wallpaper = {
    id: 'contract-wallpaper',
    userId: 'contract-profile',
    fileType: 'image',
    mimeType: 'image/png',
    width: 2,
    height: 2,
    aspectRatio: 1,
    fileSizeBytes: 20,
    uploadedAt: time,
    asset: { owner: 'ingestor', id: 'contract-wallpaper' },
  };
  const attributes = {
    specversion: '1.0',
    source: 'https://wallpaperdb/ingestor',
    id: 'contract-occurrence',
    type: 'wallpaper.uploaded',
    time,
    correlationid: 'workflow',
    causationid: 'command',
    causationsource: 'https://wallpaperdb/upload',
  };
  const structured = { ...attributes, datacontenttype: 'application/json', data: { wallpaper } };
  const legacy = { eventId: attributes.id, eventType: attributes.type, timestamp: time, wallpaper };
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const binary = (values: Record<string, string> = attributes) => {
    const result = headers();
    for (const [key, value] of Object.entries(values)) result.set(`ce-${key}`, value);
    return result;
  };
  const cases: EnvelopeConformanceCase[] = [
    { name: 'retained legacy', payload: encode(legacy), accepted: true },
    { name: 'structured', payload: encode(structured), accepted: true },
    { name: 'binary', payload: encode(legacy), metadata: binary(), accepted: true },
    {
      name: 'matching dual envelopes',
      payload: encode(structured),
      metadata: binary(),
      accepted: true,
    },
    { name: 'invalid UTF-8', payload: new Uint8Array([255]), accepted: false },
    { name: 'invalid JSON', payload: new TextEncoder().encode('{'), accepted: false },
    {
      name: 'invalid structured version',
      payload: encode({ ...structured, specversion: '0.3' }),
      accepted: false,
    },
  ];
  for (const key of Object.keys(attributes)) {
    const changed = binary();
    changed.set(`ce-${key}`, key === 'time' ? '2026-01-02T00:00:00.000Z' : 'other');
    cases.push({
      name: `dual disagreement ${key}`,
      payload: encode(structured),
      metadata: changed,
      accepted: false,
    });
    const missing = binary();
    missing.delete(`ce-${key}`);
    cases.push({
      name: `dual missing ${key}`,
      payload: encode(structured),
      metadata: missing,
      accepted: false,
    });
    const repeated = binary();
    repeated.append(`ce-${key}`, 'conflicting');
    cases.push({
      name: `repeated binary ${key}`,
      payload: encode(legacy),
      metadata: repeated,
      accepted: false,
    });
  }
  return cases.map((value) =>
    value.accepted
      ? {
          ...value,
          expected: {
            source: value.name === 'retained legacy' ? 'wallpaperdb/ingestor' : attributes.source,
            id: attributes.id,
            ...(value.name === 'retained legacy'
              ? {}
              : {
                  correlationId: attributes.correlationid,
                  causationId: attributes.causationid,
                  causationSource: attributes.causationsource,
                }),
          },
        }
      : value
  );
}
