// Throwaway UI policy and fixtures for #258. None of the HDR tuples claims
// real encoder qualification. Generation and stored-output selection belong to #256.
export type Readiness = 'ready' | 'pending' | 'original-only' | 'uninspectable' | 'failed';
export interface Asset {
  id: string;
  title: string;
  image: string;
  width?: number;
  height?: number;
  format: string;
  range?: string;
  gamut?: string;
  depth?: number;
  motion?: string;
  alpha?: boolean;
  mapDepth?: number;
  readiness: Readiness;
  confirmed: boolean;
  uploaded: boolean;
}
export interface Encoding {
  format: string;
  range: string;
  gamut: string;
  depth: number;
  motion: string;
  transparency: string[];
}
export interface Request {
  width: string;
  height: string;
  fit: string;
  format: string;
  range: string;
  gamut: string;
  motion: string;
  depth: string;
  transparency: string;
  background: string;
}
export const assets: Asset[] = [
  {
    id: 'wlpr_alpine',
    title: 'Alpine light',
    image: 'mountain',
    width: 3840,
    height: 2160,
    format: 'jpg',
    range: 'sdr',
    gamut: 'srgb',
    depth: 8,
    motion: 'static',
    alpha: false,
    readiness: 'ready',
    confirmed: true,
    uploaded: true,
  },
  {
    id: 'wlpr_lake',
    title: 'Quiet lake',
    image: 'lake',
    width: 3800,
    height: 2160,
    format: 'png',
    range: 'sdr',
    gamut: 'srgb',
    depth: 16,
    motion: 'static',
    alpha: false,
    readiness: 'ready',
    confirmed: true,
    uploaded: true,
  },
  {
    id: 'wlpr_portrait',
    title: 'Tall forest',
    image: 'forest',
    width: 4320,
    height: 7680,
    format: 'jpg',
    range: 'sdr',
    gamut: 'srgb',
    depth: 8,
    motion: 'static',
    alpha: false,
    readiness: 'ready',
    confirmed: true,
    uploaded: true,
  },
  {
    id: 'wlpr_hdr',
    title: 'Authored HDR sunset',
    image: 'sunset',
    width: 6000,
    height: 3375,
    format: 'jpg',
    range: 'hdr',
    gamut: 'p3',
    depth: 8,
    mapDepth: 8,
    motion: 'static',
    alpha: false,
    readiness: 'ready',
    confirmed: true,
    uploaded: true,
  },
  {
    id: 'wlpr_motion',
    title: 'Moving night sky',
    image: 'night',
    width: 3840,
    height: 2160,
    format: 'avif',
    range: 'hdr',
    gamut: 'rec2020',
    depth: 10,
    motion: 'animated',
    alpha: true,
    readiness: 'ready',
    confirmed: true,
    uploaded: true,
  },
  {
    id: 'wlpr_small',
    title: 'Soft morning',
    image: 'trees',
    width: 1600,
    height: 900,
    format: 'webp',
    range: 'sdr',
    gamut: 'srgb',
    depth: 8,
    motion: 'static',
    alpha: false,
    readiness: 'ready',
    confirmed: true,
    uploaded: true,
  },
  {
    id: 'wlpr_outside',
    title: 'Wider than it looks',
    image: 'lake',
    width: 3750,
    height: 2160,
    format: 'jpg',
    range: 'sdr',
    gamut: 'srgb',
    depth: 8,
    motion: 'static',
    alpha: false,
    readiness: 'ready',
    confirmed: true,
    uploaded: true,
  },
  {
    id: 'wlpr_pending',
    title: 'New upload',
    image: 'forest',
    format: 'jpg',
    readiness: 'pending',
    confirmed: true,
    uploaded: true,
  },
  {
    id: 'wlpr_unknown',
    title: 'Unknown color facts',
    image: 'trees',
    width: 3840,
    height: 2160,
    format: 'png',
    motion: 'static',
    alpha: false,
    readiness: 'original-only',
    confirmed: true,
    uploaded: true,
  },
  {
    id: 'wlpr_waiting',
    title: 'Waiting for Media',
    image: 'mountain',
    format: 'jpg',
    readiness: 'pending',
    confirmed: false,
    uploaded: true,
  },
];
// Additional display shapes for reviewing suitable-size discovery.
assets.push(
  {
    ...assets[0],
    id: 'wlpr_ultrawide',
    title: 'Wide horizon',
    image: 'lake',
    width: 6880,
    height: 2880,
  },
  {
    ...assets[0],
    id: 'wlpr_superwide',
    title: 'Across the valley',
    image: 'mountain',
    width: 7680,
    height: 2160,
  },
  {
    ...assets[0],
    id: 'wlpr_phone',
    title: 'Forest canopy',
    image: 'trees',
    width: 2160,
    height: 4800,
  }
);
export const limits = { width: 8192, height: 8192, pixels: 33554432 };
export const statusText: Record<Readiness, string> = {
  ready: 'Renditions available',
  pending: 'Preparing downloads. The original is available.',
  'original-only': 'Some source facts are unknown. Download the original.',
  uninspectable: 'This file could not be inspected. The original is available.',
  failed: 'Inspection failed. The original is available.',
};
export const defaultRequest = (a: Asset): Request => ({
  width: '1920',
  height: '1080',
  fit: 'contain',
  format: a.format,
  range: 'preserve',
  gamut: 'preserve',
  depth: 'auto',
  motion: 'preserve',
  transparency: 'preserve',
  background: '#FFFFFF',
});
export function combinations(a: Asset): Encoding[] {
  if (a.readiness !== 'ready') return [];
  const tuple = (
    format: string,
    range: string,
    gamut: string,
    depth: number,
    motion = 'static',
    transparency = ['preserve']
  ): Encoding => ({ format, range, gamut, depth, motion, transparency });
  if (a.mapDepth)
    return [
      tuple('jpg', 'hdr', 'p3', 8),
      tuple('jpg', 'sdr', 'p3', 8),
      tuple('jpg', 'sdr', 'srgb', 8),
    ];
  if (a.motion === 'animated')
    return [
      tuple('avif', 'hdr', 'rec2020', 10, 'animated'),
      tuple('avif', 'hdr', 'rec2020', 10),
      tuple('avif', 'sdr', 'srgb', 8, 'animated'),
      tuple('webp', 'sdr', 'srgb', 8, 'animated'),
      tuple('webp', 'sdr', 'srgb', 8),
      tuple('jpg', 'sdr', 'srgb', 8, 'static', ['coerce', 'background']),
    ];
  const transparency = [
    'preserve',
    'coerce',
    ...(['png', 'webp'].includes(a.format) ? ['background'] : []),
  ];
  return [
    tuple('jpg', 'sdr', 'srgb', 8, 'static', transparency),
    tuple('png', 'sdr', 'srgb', 8, 'static', transparency),
    tuple('webp', 'sdr', 'srgb', 8, 'static', transparency),
    ...(a.depth === 16 ? [tuple('png', 'sdr', 'srgb', 16, 'static', transparency)] : []),
  ];
}
export function resolve(a: Asset, r: Request) {
  if (a.readiness !== 'ready')
    return {
      error: statusText[a.readiness],
      problem: {
        pending: '503 metadata-pending; Retry-After: 5',
        failed: '500 inspection-failed',
        uninspectable: '422 source-uninspectable',
        'original-only': '422 unsupported-rendition',
      }[a.readiness],
    };
  if (!a.width || !a.height)
    return { error: 'Source dimensions are unknown.', problem: '422 unsupported-rendition' };
  let width = r.width === '' ? undefined : Number(r.width),
    height = r.height === '' ? undefined : Number(r.height);
  if ([width, height].some((n) => n !== undefined && (!Number.isInteger(n) || n < 1)))
    return {
      error: 'Enter positive whole pixels or leave the field empty.',
      problem: '400 invalid-selector',
    };
  if (width === undefined && height === undefined) {
    width = a.width;
    height = a.height;
  } else if (width === undefined)
    width = Math.max(1, Math.round(((height || 1) * a.width) / a.height));
  else if (height === undefined) height = Math.max(1, Math.round((width * a.height) / a.width));
  else if (r.fit === 'contain') {
    const scale = Math.min(width / a.width, height / a.height);
    width = Math.max(1, Math.round(a.width * scale));
    height = Math.max(1, Math.round(a.height * scale));
  }
  if (
    !width ||
    !height ||
    width > limits.width ||
    height > limits.height ||
    width * height > limits.pixels
  )
    return {
      error: 'This output exceeds Media limits. Choose a smaller size.',
      problem: '422 output-limits',
    };
  const range = r.range === 'preserve' ? a.range : r.range,
    gamut = r.gamut === 'preserve' ? a.gamut : r.gamut,
    motion = r.motion === 'preserve' ? a.motion : r.motion;
  const c = combinations(a).find(
    (c) =>
      c.format === r.format &&
      c.range === range &&
      c.gamut === gamut &&
      c.motion === motion &&
      (r.depth === 'auto' || c.depth === (r.depth === 'preserve' ? a.depth : Number(r.depth))) &&
      c.transparency.includes(r.transparency)
  );
  if (!c)
    return {
      error:
        'These choices are not supported together. Keep the original, or change the format, appearance, or transparency choices.',
      problem: '422 unsupported-rendition',
    };
  if (r.transparency === 'background' && !/^#[0-9a-f]{6}$/i.test(r.background))
    return {
      error: 'Use a six-digit sRGB background, such as #FFFFFF.',
      problem: '400 invalid-background',
    };
  const exact =
    width === a.width &&
    height === a.height &&
    c.format === a.format &&
    c.range === a.range &&
    c.gamut === a.gamut &&
    c.motion === a.motion &&
    c.depth === a.depth &&
    r.transparency === 'preserve';
  const params = new URLSearchParams({
    fit: r.fit,
    range: r.range,
    gamut: r.gamut,
    motion: r.motion,
    transparency: r.transparency === 'background' ? r.background : r.transparency,
  });
  if (r.width) params.set('w', r.width);
  if (r.height) params.set('h', r.height);
  if (r.depth !== 'auto') params.set('depth', r.depth);
  return {
    width,
    height,
    encoding: c,
    exact,
    url: `/assets/${a.id}.${c.format}?${params}`,
    filename: exact
      ? `${a.id}.${a.format}`
      : `${a.id}_${width}x${height}_${c.motion}_${c.range}_${c.gamut}_${c.depth}bit${a.mapDepth && c.range === 'hdr' ? '_map' + a.mapDepth + 'bit' : ''}_${r.transparency === 'background' ? 'bg' + r.background.slice(1) : r.transparency}.${c.format}`,
  };
}
export interface Filters {
  resolution: string;
  shape: string;
  format: string;
  range: string;
  motion: string;
  alpha: string;
}
export const initialFilters: Filters = {
  resolution: 'any',
  shape: 'preset',
  format: 'any',
  range: 'any',
  motion: 'any',
  alpha: 'any',
};
export function target(f: Filters) {
  const dimensions = f.resolution.split('x').map(Number);
  const short =
    f.resolution === 'any'
      ? 0
      : dimensions.length === 2
        ? Math.min(...dimensions)
        : Number(f.resolution);
  const presetRatio = dimensions.length === 2 ? dimensions[0] / dimensions[1] : 16 / 9;
  const ratio =
    f.shape === 'preset'
      ? short
        ? presetRatio
        : undefined
      : f.shape === 'any'
        ? undefined
        : Number(f.shape);
  return {
    width: short
      ? f.shape === 'preset' && dimensions.length === 2
        ? dimensions[0]
        : Math.ceil(short * Math.max(1, ratio || 1) - 1e-9)
      : 0,
    height: short
      ? f.shape === 'preset' && dimensions.length === 2
        ? dimensions[1]
        : Math.ceil(short * Math.max(1, ratio ? 1 / ratio : 1) - 1e-9)
      : 0,
    ratio,
  };
}
export function matches(a: Asset, f: Filters) {
  if (!a.confirmed || !a.uploaded) return false;
  const t = target(f);
  if (t.width && (!a.width || !a.height || a.width < t.width || a.height < t.height)) return false;
  if (
    t.ratio &&
    (!a.width ||
      !a.height ||
      Math.max(a.width / a.height, t.ratio) / Math.min(a.width / a.height, t.ratio) > 1.02)
  )
    return false;
  return (
    (f.format === 'any' || a.format === f.format) &&
    (f.range === 'any' || a.range === f.range) &&
    (f.motion === 'any' || a.motion === f.motion) &&
    (f.alpha === 'any' || a.alpha === (f.alpha === 'transparent'))
  );
}
export function preview(a: Asset, path: string, still: boolean, placement = 'detail') {
  if (a.readiness !== 'ready') return undefined;
  const range = a.range === 'hdr' && path === 'hdr' ? 'hdr' : 'sdr',
    motion = still ? 'static' : a.motion;
  const c = combinations(a).find(
    (c) =>
      c.range === range &&
      c.motion === motion &&
      (range === 'hdr' ? c.format === a.format : c.gamut === 'srgb') &&
      (path !== 'safari' || motion !== 'animated' || c.format === 'webp')
  );
  if (!c) return undefined;
  return {
    ...c,
    url: `/assets/${a.id}.${c.format}?w=${placement === 'grid' ? 480 : placement === 'avatar' ? 96 : placement === 'embed' ? 960 : 1600}&fit=contain&range=${range}&gamut=${c.gamut}&motion=${motion}&depth=${c.depth}&transparency=preserve`,
  };
}
