// Three download interaction variants on the existing browse/detail/Profile paths.
// Throwaway #258 entry. Real shell, theme, Muuri grid, controls and sheets;
// in-memory Asset/Media fixtures. This entry is absent from production builds.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouterState,
} from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Download,
  Eye,
  Image,
  ImageOff,
  PanelRight,
  Share2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { AppSidebar } from '@/components/app-sidebar';
import {
  BrowseFilterPanelProvider,
  useBrowseFilterPanel,
} from '@/components/browse-filter-panel-context';
import { ColorFilter } from '@/components/color-filter';
import { HeaderLayout } from '@/components/header-layout';
import { SearchBar } from '@/components/search-bar';
import { ThemeProvider } from '@/components/theme-provider';
import { ProfileOverview } from '@/components/profile/profile-overview';
import { ProfilePictureImage } from '@/components/profile/profile-picture';
import { MuuriGrid, type GridItemRendererProps } from '@/components/grid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import type { ColorPreference } from '@/lib/color-preferences';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  assets,
  combinations,
  defaultRequest,
  initialFilters,
  limits,
  matches,
  exclusionReasons,
  browseVariables,
  preview,
  resolve,
  statusText,
  target,
  type Asset,
  type Filters,
  type Readiness,
  type Request,
} from './renditions-model.prototype';
import '@/index.css';
import { ExpandingDownload } from './expanding-download.prototype';
import { BrowseShapeComparison } from './browse-shape-comparison.prototype';
import { BrowseResolutionPicker, browsePresetGroups } from './browse-resolution-picker.prototype';

const variants = [
  { key: 'A', name: 'Quick download menu' },
  { key: 'B', name: 'Download planner' },
  { key: 'C', name: 'Choose a size first' },
  { key: 'D', name: 'Expanding download menu' },
  { key: 'E', name: 'Device columns' },
];
const rootRoute = createRootRoute({
  component: PrototypeRoot,
  validateSearch: (search: Record<string, unknown>) => ({
    variant:
      typeof search.variant === 'string' && variants.some((v) => v.key === search.variant)
        ? search.variant
        : 'E',
  }),
});
const browseRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Browse });
const detailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wallpapers/$wallpaperId',
  component: Detail,
});
const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profiles/@{$handle}',
  component: Profile,
});
const uploadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/upload',
  component: () => <p className="p-8">Upload is outside this prototype. Use Browse to return.</p>,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([browseRoute, detailRoute, profileRoute, uploadRoute]),
});
function navigate(
  path: string,
  variant = new URLSearchParams(location.search).get('variant') || 'E'
) {
  void router.navigate({ href: `${path}?variant=${variant}` });
}
interface ReviewState {
  fixtures: Asset[];
  setFixtures: (value: Asset[]) => void;
  filters: Filters;
  setFilters: (value: Filters) => void;
  colors: ColorPreference[];
  setColors: (value: ColorPreference[]) => void;
  path: string;
  setPath: (value: string) => void;
  still: boolean;
  setStill: (value: boolean) => void;
  outage: boolean;
  setOutage: (value: boolean) => void;
  response: string;
  setResponse: (value: string) => void;
  pictureAvailable: boolean;
  setPictureAvailable: (value: boolean) => void;
}
const ReviewContext = createContext<ReviewState | null>(null);
function useReview() {
  const value = useContext(ReviewContext);
  if (!value) throw new Error('Prototype context missing');
  return value;
}
const photo = (a: Asset) => `/rendition-prototype/${a.image}.jpg`;
function original(a: Asset, review: ReviewState) {
  if (review.outage || review.response === '503')
    toast.error('Delivery is temporarily unavailable. Try the same original after 5 seconds.');
  else if (review.response === '404')
    toast.error('Source unavailable. Refresh its lifecycle state.');
  else
    toast.success(`Simulated original download: ${a.id}.${a.format}`, {
      description: 'Exact source bytes. No file is downloaded in this prototype.',
    });
}

function PrototypeRoot() {
  const [fixtures, setFixtures] = useState(() => structuredClone(assets));
  const [filters, setFilters] = useState(initialFilters);
  const [colors, setColors] = useState<ColorPreference[]>([]);
  const [path, setPath] = useState('sdr'),
    [still, setStill] = useState(true),
    [outage, setOutage] = useState(false),
    [response, setResponse] = useState('normal'),
    [pictureAvailable, setPictureAvailable] = useState(true);
  return (
    <ReviewContext.Provider
      value={{
        fixtures,
        setFixtures,
        filters,
        setFilters,
        colors,
        setColors,
        path,
        setPath,
        still,
        setStill,
        outage,
        setOutage,
        response,
        setResponse,
        pictureAvailable,
        setPictureAvailable,
      }}
    >
      <BrowseFilterPanelProvider>
        <ThemeProvider defaultTheme="system" storageKey="wallpaperdb-prototype-theme">
          <Shell />
          <Toaster />
        </ThemeProvider>
      </BrowseFilterPanelProvider>
    </ReviewContext.Provider>
  );
}
function useVariant() {
  const search = useRouterState({ select: (state) => state.location.searchStr });
  return new URLSearchParams(search).get('variant') || 'E';
}
function Shell() {
  const variant = useVariant();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isOpen, toggle, onBrowseLinkClick } = useBrowseFilterPanel();
  const detail = pathname.startsWith('/wallpapers/');
  return (
    <div className="[--header-height:3.5rem]">
      <SidebarProvider defaultOpen={false} className="flex flex-col">
        <header className="sticky top-0 z-50 flex h-(--header-height) w-full items-center border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <HeaderLayout
            left={
              <>
                <SidebarTrigger className="-ml-1" />
                <a
                  href={`/?variant=${variant}`}
                  onClick={onBrowseLinkClick}
                  className="flex shrink-0 items-center gap-2"
                >
                  <Image className="size-6 text-primary" />
                  <span className="hidden text-xl font-bold sm:inline">WallpaperDB</span>
                </a>
              </>
            }
            center={
              <SearchBar
                showFilterToggle={pathname === '/'}
                isFilterPanelOpen={isOpen}
                onToggleFilters={toggle}
              />
            }
            right={
              detail ? (
                <>
                  <div id="wallpaper-details-header-actions" />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Back to gallery"
                    onClick={() => navigate('/')}
                  >
                    <X className="size-4" />
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open Rafael's profile"
                  onClick={() => navigate('/profiles/@rafael')}
                >
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs text-primary">
                    RB
                  </span>
                </Button>
              )
            }
          />
        </header>
        <div className="flex flex-1">
          <AppSidebar />
          <SidebarInset>
            <main className={detail ? '' : 'pb-24'}>
              <Outlet />
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>
      {import.meta.env.DEV && <PrototypeSwitcher />}
    </div>
  );
}
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-medium">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([key, title]) => (
            <SelectItem key={key} value={key}>
              {title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
const sizeGroups = [
  {
    name: 'Desktop',
    sizes: ['1920x1080', '2560x1440', '3840x2160', '1920x1200', '2560x1600', '3840x2400'],
  },
  { name: 'Ultrawide', sizes: ['2560x1080', '3440x1440', '3840x1600', '5120x1440', '5120x2160'] },
  { name: 'Phone', sizes: ['1080x1920', '1080x2400', '1170x2532', '1290x2796', '1440x3200'] },
];
const sizeLabel = (value: string) => value.replace('x', ' × ');
function SizePicker({
  label,
  value,
  onChange,
  browse = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  browse?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={browse ? 'any' : 'source'}>
            {browse ? 'Any resolution' : 'Source size'}
          </SelectItem>
          {(browse ? browseSizeGroups : sizeGroups).map((g) => (
            <SelectGroup key={g.name}>
              <SelectLabel>{g.name}</SelectLabel>
              {g.sizes.map((size) => (
                <SelectItem key={size} value={size}>
                  {sizeLabel(size)}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
          {!browse && <SelectItem value="custom">Custom</SelectItem>}
        </SelectContent>
      </Select>
    </label>
  );
}
// Accepted browse presets and column layout. Download choices remain unchanged.
const browseSizeGroups = browsePresetGroups;
function Browse() {
  const r = useReview(),
    { isOpen } = useBrowseFilterPanel();
  const { colors, setColors } = r;
  const [reviewOpen, setReviewOpen] = useState(true);
  const [scenario, setScenario] = useState('boundaries');
  // Synthetic utilities only. This demo checks eligibility/order/reset, not color scoring.
  const colorReady = (a: Asset) =>
    !['wlpr_pending', 'wlpr_unknown', 'wlpr_waiting', 'wlpr_failed'].includes(a.id);
  const score = (a: Asset) =>
    a.id === 'wlpr_alpine'
      ? 0
      : colors.reduce(
          (total, color) =>
            total +
            [...(a.id + JSON.stringify(color))].reduce(
              (sum, char) => (sum * 31 + char.charCodeAt(0)) % 101,
              0
            ) /
              100 /
              colors.length,
          0
        );
  const filtered = r.fixtures.filter(
    (a) => matches(a, r.filters) && (!colors.length || colorReady(a))
  );
  if (colors.length) filtered.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const clear = () => {
    r.setFilters({
      ...initialFilters,
      tolerance: r.filters.tolerance,
    });
    setColors([]);
  };
  const scenarios: Record<
    string,
    { description: string; steps: [string, Partial<Filters>, ColorPreference[]?][] }
  > = {
    boundaries: {
      description:
        'Compare just inside, exactly on, and one pixel beyond the proposed symmetric boundary. Dimensions are checked separately.',
      steps: [
        ['Start with 1080p desktop', { selection: '1920x1080' }],
        ['Try 1%', { tolerance: '1' }],
        ['Try 2%', { tolerance: '2' }],
        ['Try 3%', { tolerance: '3' }],
        ['Use accepted 5%', { tolerance: '5' }],
      ],
    },
    presets: {
      description:
        'Presets use their actual pixel ratio. 3440 × 1440 is 43:18. Choosing 21:9 replaces that preset with a shape-only query.',
      steps: [
        ['Start with 3440 × 1440', { selection: '3440x1440' }],
        ['Override to exact 21:9', { selection: 'ratio:21/9' }],
        ['Choose the 3440 × 1440 preset again', { selection: '3440x1440' }],
        ['Try 1080 × 2400 phone', { selection: '1080x2400' }],
      ],
    },
    overrides: {
      description:
        'One active size-and-shape choice. Ratio-only replaces the preset and removes its dimension minimum. A new preset replaces the ratio-only choice. Other filters remain selected.',
      steps: [
        ['Start with 1080p desktop', { selection: '1920x1080' }],
        ['Choose 9:16 instead', { selection: 'ratio:9/16' }],
        ['Choose unrestricted size and shape', { selection: 'any' }],
        ['Choose a phone preset', { selection: '1080x1920' }],
        ['Choose shape without a size', { selection: 'ratio:9/16' }],
      ],
    },
    intersection: {
      description:
        'Source filters intersect. Conversions do not qualify sources. Color ranks eligible records, including zero scores; unknown color banks exclude only color queries.',
      steps: [
        ['Start with 1080p desktop', { selection: '1920x1080' }],
        ['Require HDR', { range: 'hdr' }],
        ['Require animation', { motion: 'animated' }],
        ['Require transparency', { alpha: 'transparent' }],
        ['Require AVIF source', { format: 'avif' }],
        ['Rank by blue', {}, [{ name: 'BLUE', quality: 'FAVORITE' }]],
        ['Switch to PNG source, empty result', { format: 'png' }],
      ],
    },
    unknown: {
      description:
        'Pending/failed inspection does not hide a confirmed source. A temporary outage does not change the browse set. Unknown facts exclude only queries that need them.',
      steps: [
        ['Start unfiltered', {}],
        ['Require known dimensions', { selection: '1920x1080' }],
        ['Remove dimensions, require HDR', { selection: 'any', range: 'hdr' }],
        [
          'Remove range, require complete color bank',
          { range: 'any' },
          [{ name: 'BLUE', quality: 'FAVORITE' }],
        ],
      ],
    },
  };
  const startScenario = (name: string) => {
    setScenario(name);
    clear();
    r.setOutage(false);
  };
  const reasons = (a: Asset) => [
    ...exclusionReasons(a, r.filters),
    ...(colors.length && !colorReady(a) ? ['Color utilities unknown'] : []),
  ];
  const t = target(r.filters);
  const set = (key: keyof Filters, value: string) => r.setFilters({ ...r.filters, [key]: value });
  return (
    <>
      <section className="border-b bg-muted/20 px-4 py-3">
        <div className="mx-auto flex max-w-6xl flex-col gap-3">
          <div className="flex items-center gap-3">
            <BrowseResolutionPicker
              value={r.filters.selection}
              onChange={(value) => set('selection', value)}
            />
          </div>
          {isOpen && (
            <>
              <ColorFilter value={colors} onChange={setColors} />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                <Choice
                  label="Source format"
                  value={r.filters.format}
                  options={['any', 'jpg', 'png', 'webp', 'avif', 'gif'].map((v) => [
                    v,
                    v === 'any' ? 'Any format' : v.toUpperCase(),
                  ])}
                  onChange={(v) => set('format', v)}
                />
                <Choice
                  label="Source dynamic range"
                  value={r.filters.range}
                  options={['any', 'sdr', 'hdr'].map((v) => [
                    v,
                    v === 'any' ? 'SDR and HDR' : v.toUpperCase(),
                  ])}
                  onChange={(v) => set('range', v)}
                />
                <Choice
                  label="Source motion"
                  value={r.filters.motion}
                  options={['any', 'static', 'animated'].map((v) => [
                    v,
                    v === 'any' ? 'Any motion' : v,
                  ])}
                  onChange={(v) => set('motion', v)}
                />
                <Choice
                  label="Source transparency"
                  value={r.filters.alpha}
                  options={['any', 'opaque', 'transparent'].map((v) => [
                    v,
                    v === 'any' ? 'Any transparency' : v,
                  ])}
                  onChange={(v) => set('alpha', v)}
                />
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {t.width
                ? `At least ${t.width} × ${t.height} displayed pixels`
                : 'Any source dimensions'}
              {t.ratio ? ` · shape within ${r.filters.tolerance}% inclusive` : ' · any shape'}
            </span>
            {Object.entries(r.filters)
              .filter(
                ([key, value]) =>
                  value !== 'any' && value !== 'preset' && !['selection', 'tolerance'].includes(key)
              )
              .map(([key, value]) => (
                <Badge key={key} variant="secondary">
                  {key}: {value}
                </Badge>
              ))}
            <Button variant="ghost" size="sm" className="h-6" onClick={clear}>
              Clear filters
            </Button>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-6xl space-y-4 p-4">
        <Button variant="outline" onClick={() => setReviewOpen(!reviewOpen)}>
          {reviewOpen ? 'Hide' : 'Show'} #326 browse review
        </Button>
        {reviewOpen && (
          <div className="space-y-4 rounded-xl border p-4">
            <h1 className="text-lg font-semibold">Accepted suitable-resolution browse rules</h1>
            <p className="text-sm text-muted-foreground">
              Throwaway prototype. Inclusive 5% tolerance and the nine presets in device columns are
              accepted. The combined chooser replaces conflicting preset and shape pairs with one
              selection. Ratio-only choices have no size minimum. Other filter selections stay
              independent, with separate chooser and full-filter resets. Request field names remain
              a proposal for #259. Download design E remains accepted. Source facts are simulated
              and photos are placeholders. These controls are review aids.
            </p>
            <BrowseShapeComparison />
            <div className="grid gap-4 sm:grid-cols-3">
              <Choice
                label="Review tolerance, accepted 5%"
                value={r.filters.tolerance}
                options={['0', '1', '2', '3', '5'].map((v) => [v, `${v}% inclusive`])}
                onChange={(v) => set('tolerance', v)}
              />
            </div>
            <p className="text-xs">
              Shape distance is max(source ratio, target ratio) / min(source ratio, target ratio) −
              1. Exactly on the boundary qualifies; display rounding does not decide eligibility.
              Preset shape uses its exact dimensions. A ratio-only choice replaces the preset and
              removes its size minimum.
            </p>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Browse walkthroughs">
              {Object.keys(scenarios).map((name) => (
                <Button
                  key={name}
                  size="sm"
                  variant={scenario === name ? 'default' : 'outline'}
                  role="tab"
                  aria-selected={scenario === name}
                  onClick={() => startScenario(name)}
                >
                  {name}
                </Button>
              ))}
            </div>
            <p className="text-sm">{scenarios[scenario].description}</p>
            <div className="flex flex-wrap gap-2">
              {scenarios[scenario].steps.map(([label, patch, targets], index) => (
                <Button
                  key={label}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (index === 0) {
                      r.setFilters({
                        ...initialFilters,
                        tolerance: r.filters.tolerance,
                        ...patch,
                      });
                      setColors(targets || []);
                    } else {
                      r.setFilters({ ...r.filters, ...patch });
                      if (targets) setColors(targets);
                    }
                  }}
                >
                  {index + 1}. {label}
                </Button>
              ))}
              <Button size="sm" variant="outline" onClick={() => r.setOutage(!r.outage)}>
                {r.outage ? 'Restore delivery' : 'Simulate delivery outage'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => set('selection', 'any')}>
                Clear size and shape only
              </Button>
              <Button size="sm" variant="outline" onClick={() => setColors([])}>
                Clear color only
              </Button>
              <Button size="sm" onClick={clear}>
                Clear all browse filters
              </Button>
            </div>
            <div className="rounded-lg bg-muted p-3 text-sm" aria-live="polite">
              <p>
                {t.width ? `Minimum ${t.width} × ${t.height}` : 'No minimum source dimensions'};
                shape {t.ratio?.toFixed(6) || 'unrestricted'}; tolerance {r.filters.tolerance}%;
                selection {r.filters.selection}.
              </p>
              <p>
                Source format {r.filters.format}; range {r.filters.range}; motion {r.filters.motion}
                ; transparency {r.filters.alpha}; delivery {r.outage ? 'outage' : 'normal'};{' '}
                {filtered.length} matches.
              </p>
              <p>
                Color targets{' '}
                {colors.length
                  ? colors
                      .map(
                        (c) =>
                          `${c.name || c.color}, ${c.quality}, ${c.percent === undefined ? 'vibe' : `${c.percent}%`}`
                      )
                      .join('; ')
                  : 'none'}
                . Synthetic color scores demonstrate ordering only, not the accepted scoring
                algorithm. Zero-score records remain eligible.
              </p>
            </div>
            <details className="rounded-lg border p-3" open>
              <summary className="cursor-pointer text-sm">
                Proposed GraphQL variables, not a live API
              </summary>
              <p className="my-2 text-xs text-muted-foreground">
                Gateway filters verified source facts. Web expands the selected preset; no preset
                names or download fit options go to Media. Field names are a proposal for #259.
              </p>
              <pre className="overflow-x-auto text-xs">
                {JSON.stringify(
                  {
                    ...browseVariables(r.filters),
                    ...(colors.length
                      ? {
                          sort: {
                            color: {
                              targets: colors.map((c) => ({
                                ...c,
                                mode: c.percent === undefined ? 'VIBE' : 'PROPORTIONS',
                              })),
                            },
                          },
                        }
                      : {}),
                  },
                  null,
                  2
                )}
              </pre>
            </details>
            <div className="max-h-80 overflow-auto rounded-lg border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr>
                    <th className="p-2">Source example</th>
                    <th className="p-2">Displayed dimensions / shape distance</th>
                    <th className="p-2">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {r.fixtures.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="p-2">
                        {a.title}
                        <br />
                        {a.format} · {a.range || 'range unknown'} · {a.motion || 'motion unknown'} ·{' '}
                        {a.alpha === undefined
                          ? 'transparency unknown'
                          : a.alpha
                            ? 'transparent'
                            : 'opaque'}
                      </td>
                      <td className="p-2">
                        {a.width || '?'} × {a.height || '?'}
                        <br />
                        {t.ratio && a.width && a.height
                          ? `${((Math.max(a.width / a.height, t.ratio) / Math.min(a.width / a.height, t.ratio) - 1) * 100).toFixed(4)}%`
                          : 'Shape not required or unknown'}
                      </td>
                      <td className="p-2">
                        {reasons(a).join('; ') ||
                          `Included${colors.length ? ` · synthetic score ${score(a).toFixed(2)}` : ''}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <a
              className="text-sm text-primary underline"
              href="/prototypes/suitable-resolution.prototype.html"
            >
              Open portable logic walkthrough
            </a>
          </div>
        )}
      </section>
      <AssetGrid list={filtered} />
      {!filtered.length && (
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
          <ImageOff className="mx-auto mb-4 size-8 text-muted-foreground" />
          <h2 className="text-xl font-semibold">No matching wallpapers</h2>
          <p className="my-3 text-muted-foreground">
            Try another resolution or remove a source filter.
          </p>
          <Button variant="outline" onClick={clear}>
            Clear filters
          </Button>
        </div>
      )}
    </>
  );
}
function AssetGrid({ list }: { list: Asset[] }) {
  const mobile = useIsMobile();
  const items = useMemo(
    () =>
      list.map((a) => ({
        id: a.id,
        src: photo(a),
        width: a.width || 1600,
        height: a.height || 900,
        aspectRatio: a.width && a.height ? a.width / a.height : 16 / 9,
      })),
    [list]
  );
  return <MuuriGrid items={items} baseSize={mobile ? 90 : 375} gap={16} ItemRenderer={AssetCard} />;
}
function AssetCard({
  item,
  isExpanded,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: GridItemRendererProps) {
  const r = useReview(),
    a = r.fixtures.find((a) => a.id === item.id);
  if (!a) return null;
  const p = preview(a, r.path, r.still, 'grid');
  return (
    <fieldset
      className="relative m-0 h-full w-full min-w-0 border-0 p-0"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        type="button"
        className={`relative h-full w-full cursor-pointer overflow-hidden rounded-lg shadow ${isExpanded ? 'ring-2 ring-primary shadow-xl' : ''}`}
        onClick={onClick}
        aria-label={`Wallpaper ${a.title}`}
        aria-expanded={isExpanded}
      >
        {p && !r.outage ? (
          <img src={item.src} alt={a.title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-muted px-6 text-sm text-muted-foreground">
            <ImageOff className="size-7" />
            <span>{r.outage ? 'Preview temporarily unavailable' : statusText[a.readiness]}</span>
            <span>{a.title}</span>
          </div>
        )}
        {a.range === 'hdr' && (
          <Badge className="absolute top-2 right-2" variant="secondary">
            HDR source
          </Badge>
        )}
        {a.motion === 'animated' && (
          <Badge className="absolute top-2 left-2" variant="secondary">
            Animated source
          </Badge>
        )}
      </button>
      {isExpanded && (
        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-black/60 px-2 py-1.5 text-white">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-white hover:bg-white/20 hover:text-white"
            aria-label={`View ${a.title}`}
            onClick={() => navigate(`/wallpapers/${a.id}`)}
          >
            <Eye />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-white hover:bg-white/20 hover:text-white"
            aria-label={`Download original ${a.title}`}
            onClick={() => original(a, r)}
          >
            <Download />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-white hover:bg-white/20 hover:text-white"
            aria-label="Share wallpaper"
            onClick={() => toast('Simulated share', { description: `/wallpapers/${a.id}` })}
          >
            <Share2 />
          </Button>
        </div>
      )}
    </fieldset>
  );
}
function ImageView({ asset, className = '' }: { asset: Asset; className?: string }) {
  const r = useReview(),
    p = preview(asset, r.path, r.still);
  return (
    <div className={`flex min-h-0 items-center justify-center overflow-hidden ${className}`}>
      {p && !r.outage ? (
        <img
          src={photo(asset)}
          alt={asset.title}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <div className="flex h-full w-full min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/20 p-6 text-center">
          <ImageOff className="size-8 text-muted-foreground" />
          <p>{r.outage ? 'Preview temporarily unavailable.' : statusText[asset.readiness]}</p>
          <p className="text-sm text-muted-foreground">
            Your original download is still accessible.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast(
                r.outage
                  ? 'Still temporarily unavailable. Try again after 5 seconds.'
                  : asset.readiness === 'pending'
                    ? 'Inspection is still pending. Try again after 5 seconds.'
                    : 'No new inspection result. Original download is available.'
              )
            }
          >
            Try preview again
          </Button>
        </div>
      )}
    </div>
  );
}
function SourceBadges({ asset }: { asset: Asset }) {
  const r = useReview(),
    p = preview(asset, r.path, r.still);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
      <Badge variant="secondary">{asset.format.toUpperCase()} source</Badge>
      <span>{asset.width ? `${asset.width} × ${asset.height}` : 'Dimensions pending'}</span>
      {asset.range && <Badge variant="secondary">{asset.range.toUpperCase()}</Badge>}
      {p && (
        <span className="text-xs">
          Viewing {p.range.toUpperCase()} {p.motion === 'static' ? 'still' : 'animation'}
        </span>
      )}
    </div>
  );
}
function Metadata({ asset }: { asset: Asset }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center gap-3 py-4">
          <button
            onClick={() => navigate('/profiles/@rafael')}
            className="flex items-center gap-3 text-left"
          >
            <span className="flex size-12 items-center justify-center rounded-xl bg-primary/15 font-bold text-primary">
              RB
            </span>
            <span>
              <span className="block font-medium">Rafael Bieze</span>
              <span className="text-sm text-muted-foreground">@rafael</span>
            </span>
          </button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <span className="block text-muted-foreground">Wallpaper ID</span>
            <span className="font-mono">{asset.id}</span>
          </p>
          <p>
            <span className="block text-muted-foreground">Uploaded</span>October 1, 2026
          </p>
          <p>
            <span className="block text-muted-foreground">Source</span>
            {asset.width ? `${asset.width} × ${asset.height}` : 'Dimensions not yet verified'} ·{' '}
            {asset.format.toUpperCase()} · {asset.range?.toUpperCase() || 'Range unknown'}
          </p>
          <p>{statusText[asset.readiness]}</p>
        </CardContent>
      </Card>
    </div>
  );
}
function Detail() {
  const r = useReview(),
    variant = useVariant(),
    { wallpaperId } = detailRoute.useParams();
  const asset = r.fixtures.find((a) => a.id === wallpaperId);
  if (!asset || !asset.uploaded || !asset.confirmed)
    return (
      <div className="p-12 text-center">
        <h1 className="text-xl">Wallpaper is not available yet</h1>
        <Button className="mt-4" onClick={() => navigate('/')}>
          Back to gallery
        </Button>
      </div>
    );
  return <DetailVariants key={asset.id} asset={asset} variant={variant} />;
}
function DetailVariants({ asset, variant }: { asset: Asset; variant: string }) {
  const [request, setRequest] = useState(() => defaultRequest(asset));
  const [customSize, setCustomSize] = useState(false);
  const [panel, setPanel] = useState(false),
    [downloadOpen, setDownloadOpen] = useState(false);
  const r = useReview(),
    mobile = useIsMobile();
  const downloadProps = { asset, request, setRequest, customSize };
  return (
    <>
      <div className="fixed inset-0 top-[3.5rem] bg-background p-4 pb-24">
        {variant === 'B' ? (
          <VariantB
            asset={asset}
            downloadProps={downloadProps}
            onMobileDownload={() => setDownloadOpen(true)}
            onMetadata={() => setPanel(true)}
          />
        ) : (
          <div className="flex h-full flex-col gap-3">
            <ImageView asset={asset} className="flex-1" />
            <div className="flex shrink-0 flex-col items-center gap-3">
              <SourceBadges asset={asset} />
              <div className="flex flex-wrap justify-center gap-2">
                {variant === 'D' || variant === 'E' ? (
                  <ExpandingDownload
                    asset={asset}
                    columns={variant === 'E'}
                    onOriginal={() => original(asset, r)}
                    outage={r.outage}
                    response={r.response}
                  />
                ) : variant === 'A' ? (
                  <>
                    <Button onClick={() => original(asset, r)}>
                      <Download className="size-4" />
                      Download original
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline">
                          Other sizes
                          <ChevronDown className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-64" align="end">
                        {sizeGroups.map((group) => (
                          <DropdownMenuSub key={group.name}>
                            <DropdownMenuSubTrigger>{group.name}</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-48">
                              {group.sizes.map((size) => {
                                const [width, height] = size.split('x');
                                return (
                                  <DropdownMenuItem
                                    key={size}
                                    disabled={asset.readiness !== 'ready'}
                                    onSelect={() => {
                                      setRequest({ ...defaultRequest(asset), width, height });
                                      setDownloadOpen(true);
                                    }}
                                  >
                                    {sizeLabel(size)}
                                  </DropdownMenuItem>
                                );
                              })}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => {
                            setCustomSize(true);
                            setDownloadOpen(true);
                          }}
                        >
                          Custom…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                ) : (
                  <Button onClick={() => setDownloadOpen(true)}>
                    <Download className="size-4" />
                    Download…
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() =>
                    toast('Simulated share', { description: `/wallpapers/${asset.id}` })
                  }
                >
                  <Share2 className="size-4" />
                  Share
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setPanel(true)}
                  aria-label="Wallpaper details"
                >
                  <PanelRight className="size-4" />
                </Button>
              </div>
              {asset.readiness !== 'ready' && (
                <p className="max-w-lg text-center text-xs text-muted-foreground">
                  {statusText[asset.readiness]}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      <Sheet open={panel} onOpenChange={setPanel}>
        <SheetContent
          side={mobile ? 'bottom' : 'right'}
          className={`${mobile ? 'h-[85vh]' : 'w-full sm:max-w-md lg:max-w-lg'} overflow-y-auto p-6 pb-24`}
        >
          <SheetTitle>Wallpaper details</SheetTitle>
          <SheetDescription>Contributor and original source information.</SheetDescription>
          <Metadata asset={asset} />
        </SheetContent>
      </Sheet>
      <Sheet open={downloadOpen} onOpenChange={setDownloadOpen}>
        <SheetContent
          side={variant === 'C' || mobile ? 'bottom' : 'right'}
          className={
            variant === 'C' || mobile
              ? 'max-h-[88vh] overflow-y-auto p-6 pb-24'
              : 'w-full overflow-y-auto p-6 pb-24 sm:max-w-md lg:max-w-lg'
          }
        >
          <SheetTitle>{variant === 'C' ? 'What size do you need?' : 'Download'}</SheetTitle>
          <SheetDescription>
            {asset.title} · {asset.format.toUpperCase()} source
          </SheetDescription>
          {variant === 'C' ? (
            <VariantC {...downloadProps} />
          ) : (
            <>
              <DownloadForm {...downloadProps} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
function VariantB({
  asset,
  downloadProps,
  onMobileDownload,
  onMetadata,
}: {
  asset: Asset;
  downloadProps: DownloadProps;
  onMobileDownload: () => void;
  onMetadata: () => void;
}) {
  return (
    <div className="flex h-full gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <ImageView asset={asset} className="flex-1" />
        <SourceBadges asset={asset} />
        <div className="flex justify-center gap-2">
          <Button className="lg:hidden" onClick={onMobileDownload}>
            <Download className="size-4" />
            Choose download
          </Button>
          <Button variant="outline" onClick={onMetadata}>
            <PanelRight className="size-4" />
            Details
          </Button>
          <Button variant="outline" onClick={() => toast('Simulated share')}>
            <Share2 className="size-4" />
            Share
          </Button>
        </div>
      </div>
      <aside className="hidden w-88 shrink-0 overflow-y-auto border-l pl-6 lg:block">
        <h1 className="mb-1 text-xl font-semibold">Download</h1>
        <p className="mb-5 text-sm text-muted-foreground">{asset.title}</p>
        <DownloadForm {...downloadProps} />
        <div className="mt-6 border-t pt-5">
          <OriginalCard asset={asset} />
        </div>
      </aside>
    </div>
  );
}
interface DownloadProps {
  customSize?: boolean;
  asset: Asset;
  request: Request;
  setRequest: (r: Request) => void;
}
function OriginalCard({ asset }: { asset: Asset }) {
  const r = useReview();
  return (
    <Button variant="outline" className="w-full" onClick={() => original(asset, r)}>
      <Download className="size-4" />
      Download original
    </Button>
  );
}
function VariantC(props: DownloadProps) {
  const { asset, request, setRequest } = props;
  const [mode, setMode] = useState('original');
  const r = useReview();
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ['original', 'Original', ''],
          ['screen', 'Display', ''],
          ['custom', 'Custom', ''],
        ].map(([key, title, help]) => (
          <button
            key={key}
            aria-pressed={mode === key}
            className={`rounded-xl border p-4 text-left ${mode === key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted'}`}
            onClick={() => {
              setMode(key);
              if (key === 'screen') setRequest({ ...request, width: '1920', height: '1080' });
            }}
          >
            <span className="block font-medium">{title}</span>
            <span className="text-xs text-muted-foreground">{help}</span>
          </button>
        ))}
      </div>
      {mode === 'original' ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-muted/40 p-5">
          <div>
            <p>
              {asset.width ? `${asset.width} × ${asset.height} · ` : ''}
              {asset.format.toUpperCase()} · {asset.range?.toUpperCase() || 'Uninspected source'}
            </p>
          </div>
          <Button onClick={() => original(asset, r)}>
            <Download className="size-4" />
            Download original
          </Button>
        </div>
      ) : (
        <DownloadForm {...props} customSize={mode === 'custom'} />
      )}
    </div>
  );
}
function DownloadForm({
  asset,
  request,
  setRequest,
  customSize = false,
}: DownloadProps & { taskLayout?: boolean; mode?: string }) {
  const r = useReview(),
    result = resolve(asset, request);
  const [receipt, setReceipt] = useState('');
  const selectedSize =
    request.width === '' && request.height === ''
      ? 'source'
      : sizeGroups.some((g) => g.sizes.includes(`${request.width}x${request.height}`))
        ? `${request.width}x${request.height}`
        : 'custom';
  const [custom, setCustom] = useState(customSize || selectedSize === 'custom');
  const set = (key: keyof Request, value: string) => {
    setRequest({ ...request, [key]: value });
    setReceipt('');
  };
  const color =
    request.range === 'sdr' && request.gamut === 'srgb'
      ? 'sdr'
      : request.range === 'preserve' && request.gamut === 'preserve'
        ? 'preserve'
        : 'custom';
  const tuples = combinations(asset).filter(
    (c) =>
      c.range === (request.range === 'preserve' ? asset.range : request.range) &&
      c.gamut === (request.gamut === 'preserve' ? asset.gamut : request.gamut) &&
      c.motion === (request.motion === 'preserve' ? asset.motion : request.motion) &&
      c.transparency.includes(request.transparency)
  );
  const formats = [...new Set([request.format, ...tuples.map((c) => c.format)])];
  const send = () => {
    if (r.outage || r.response === '503')
      setReceipt('Temporarily unavailable. Try again in 5 seconds.');
    else if (r.response === '404') setReceipt('Source unavailable.');
    else if (r.response === '422')
      setReceipt('This combination is no longer supported. Choose another.');
    else if (r.response === 'limits') setReceipt('Size exceeds current limits.');
    else if (r.response === '400') setReceipt('Invalid request. Check your choices.');
    else {
      setReceipt('Download ready.');
      toast.success('Simulated download', { description: result.filename });
    }
  };
  const warning = [
    asset.range === 'hdr' && color === 'sdr' ? 'Converted to SDR' : '',
    asset.motion === 'animated' && request.motion === 'static' ? 'Still frame' : '',
    asset.depth && result.encoding && result.encoding.depth < asset.depth
      ? `${result.encoding.depth}-bit output`
      : '',
    request.transparency !== 'preserve' && asset.alpha ? 'Transparency removed' : '',
  ].filter(Boolean);
  return (
    <div className="space-y-4">
      <SizePicker
        label="Size"
        value={custom ? 'custom' : selectedSize}
        onChange={(value) => {
          setCustom(value === 'custom');
          setReceipt('');
          if (value !== 'custom') {
            const [width, height] = value === 'source' ? ['', ''] : value.split('x');
            setRequest({ ...request, width, height });
          }
        }}
      />
      {custom && (
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-xs font-medium">
            Width
            <Input
              aria-label="Width"
              value={request.width}
              placeholder="Auto"
              inputMode="numeric"
              onChange={(e) => set('width', e.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Height
            <Input
              aria-label="Height"
              value={request.height}
              placeholder="Auto"
              inputMode="numeric"
              onChange={(e) => set('height', e.target.value)}
            />
          </label>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {formats.length > 1 && (
          <Choice
            label="Format"
            value={request.format}
            options={formats.map((v) => [v, v === 'jpg' ? 'JPEG' : v.toUpperCase()])}
            onChange={(v) => set('format', v)}
          />
        )}
        {asset.range === 'hdr' && (
          <Choice
            label="Color"
            value={color}
            options={[
              ['preserve', 'HDR · original gamut'],
              ['sdr', 'SDR · sRGB'],
              ...(color === 'custom' ? [['custom', 'Custom'] satisfies [string, string]] : []),
            ]}
            onChange={(value) => {
              if (value === 'custom') return;
              setRequest({
                ...request,
                range: value === 'sdr' ? 'sdr' : 'preserve',
                gamut: value === 'sdr' ? 'srgb' : 'preserve',
              });
              setReceipt('');
            }}
          />
        )}
      </div>
      {asset.motion === 'animated' && (
        <Choice
          label="Motion"
          value={request.motion}
          options={[
            ['preserve', 'Animated'],
            ['static', 'Still frame'],
          ]}
          onChange={(v) => set('motion', v)}
        />
      )}
      <details className="border-t pt-3">
        <summary className="cursor-pointer text-sm text-muted-foreground">Advanced</summary>
        <div className="mt-3 space-y-3">
          <Choice
            label="Fit"
            value={request.fit}
            options={[
              ['contain', 'Fit inside'],
              ['cover', 'Center crop'],
              ['fill', 'Stretch'],
            ]}
            onChange={(v) => set('fit', v)}
          />
          <Choice
            label="Gamut"
            value={request.gamut}
            options={[
              ['preserve', 'Original'],
              ['srgb', 'sRGB'],
              ['p3', 'Display P3'],
              ['rec2020', 'Rec.2020'],
            ]}
            onChange={(v) => set('gamut', v)}
          />
          <Choice
            label="Depth"
            value={request.depth}
            options={[
              ['auto', 'Automatic'],
              ['preserve', 'Original'],
              ['8', '8 bit'],
              ['10', '10 bit'],
              ['12', '12 bit'],
              ['16', '16 bit'],
            ]}
            onChange={(v) => set('depth', v)}
          />
          {asset.alpha && (
            <>
              <Choice
                label="Transparency"
                value={request.transparency}
                options={[
                  ['preserve', 'Preserve'],
                  ['background', 'Background'],
                  ['coerce', 'Discard for format'],
                ]}
                onChange={(v) => set('transparency', v)}
              />
              {request.transparency === 'background' && (
                <Input
                  aria-label="Background color"
                  value={request.background}
                  onChange={(e) => set('background', e.target.value)}
                />
              )}
            </>
          )}
        </div>
      </details>
      {result.error ? (
        <p role="status" className="text-sm text-destructive">
          {asset.readiness === 'ready'
            ? result.problem?.startsWith('400')
              ? 'Check the size or background.'
              : result.problem === '422 output-limits'
                ? 'Size exceeds Media limits.'
                : 'This combination is unavailable.'
            : statusText[asset.readiness]}
        </p>
      ) : (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            {result.width} × {result.height} · {result.encoding?.format.toUpperCase()} ·{' '}
            {result.encoding?.range.toUpperCase()}
            {result.exact ? ' · original bytes' : ''}
          </p>
          {warning.length > 0 && <p className="text-foreground">{warning.join(' · ')}</p>}
          {request.fit === 'cover' && <p>Center cropped</p>}
          {request.fit === 'fill' && <p>Stretched</p>}
          {asset.width && result.width && result.width > asset.width && <p>Upscaled</p>}
        </div>
      )}
      <Button className="w-full" disabled={Boolean(result.error)} onClick={send}>
        <Download className="size-4" />
        Download
      </Button>
      {receipt && (
        <div role="status" className="text-sm">
          {receipt}
          {(r.outage || r.response === '503') && (
            <Button variant="link" size="sm" onClick={send}>
              Retry
            </Button>
          )}
        </div>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">File details</summary>
        <p className="mt-2 break-all font-mono">{result.filename || result.problem}</p>
        <code className="break-all">{result.url}</code>
      </details>
    </div>
  );
}
function Profile() {
  const r = useReview(),
    asset = r.fixtures.find((a) => a.id === 'wlpr_hdr') || r.fixtures[0];
  const profile = {
    id: 'profile_rafael',
    displayName: 'Rafael Bieze',
    handle: 'rafael',
    picture:
      r.pictureAvailable && !r.outage
        ? { id: 'pic_aurora', url: '/rendition-prototype/night.jpg' }
        : null,
  };
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <ProfileOverview
        profile={profile}
        picture={<ProfilePictureImage profile={profile} />}
        biography={
          <div className="space-y-4">
            <p>I collect landscapes, light, and places worth returning to.</p>
            <div className="overflow-hidden rounded-xl border bg-muted/30">
              <button
                className="block w-full text-left"
                onClick={() => navigate(`/wallpapers/${asset.id}`)}
              >
                <ImageView asset={asset} className="h-64" />
                <span className="block px-3 py-2 text-sm font-medium text-primary">
                  View wallpaper
                </span>
              </button>
            </div>
          </div>
        }
      />
      <section className="mt-10">
        <AssetGrid list={r.fixtures.filter((a) => a.confirmed && a.uploaded).slice(0, 6)} />
      </section>
    </div>
  );
}
function PrototypeSwitcher() {
  const variant = useVariant(),
    r = useReview(),
    mobile = useIsMobile();
  const [reviewOpen, setReviewOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const selected = r.fixtures.find((a) => pathname.endsWith(a.id)) || r.fixtures[0];
  const current = variants.findIndex((v) => v.key === variant);
  const cycle = (direction: number) =>
    navigate(pathname, variants[(current + direction + variants.length) % variants.length].key);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const element = event.target;
      if (
        reviewOpen ||
        (element instanceof HTMLElement &&
          (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(element.tagName) ||
            element.isContentEditable ||
            element.closest('[role="dialog"], [role="menu"], [role="listbox"]')))
      )
        return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        cycle(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  });
  const mutate = (patch: Partial<Asset>) =>
    r.setFixtures(r.fixtures.map((a) => (a.id === selected.id ? { ...a, ...patch } : a)));
  return (
    <>
      <div className="fixed bottom-4 left-1/2 z-[70] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-white/20 bg-zinc-950 px-2 py-1.5 text-white shadow-xl">
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/15 hover:text-white"
          aria-label="Previous prototype"
          onClick={() => cycle(-1)}
        >
          <ArrowLeft />
        </Button>
        <span className="px-1 text-xs whitespace-nowrap">
          <span className="hidden sm:inline">Prototype </span>
          {variant} · {variants[current].name}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/15 hover:text-white"
          aria-label="Next prototype"
          onClick={() => cycle(1)}
        >
          <ArrowRight />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-white hover:bg-white/15 hover:text-white"
          aria-label="Prototype review controls"
          onClick={() => setReviewOpen(true)}
        >
          <SlidersHorizontal />
        </Button>
      </div>
      <Sheet open={reviewOpen} onOpenChange={setReviewOpen}>
        <SheetContent
          side={mobile ? 'bottom' : 'right'}
          className="max-h-[90vh] overflow-y-auto p-6 pb-24 sm:max-w-lg"
        >
          <SheetTitle>Prototype review controls</SheetTitle>
          <SheetDescription>
            Throwaway UI for #258. In-memory fixtures and simulated downloads. Photos are SDR
            placeholders; no HDR qualification is claimed.
          </SheetDescription>
          <div className="space-y-4">
            <p className="text-sm">
              A preserves the existing quick menu. B puts download planning beside the image. C asks
              for the intended size in a bottom sheet.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                navigate(`/wallpapers/${selected.id}`);
                setReviewOpen(false);
              }}
            >
              Open wallpaper detail
            </Button>
            <Choice
              label="Inspect a fixture"
              value={selected.id}
              options={r.fixtures.map((a) => [a.id, a.title])}
              onChange={(id) => navigate(`/wallpapers/${id}`)}
            />
            <Choice
              label="Inspection readiness"
              value={selected.readiness}
              options={(
                [
                  'ready',
                  'pending',
                  'original-only',
                  'uninspectable',
                  'failed',
                ] satisfies Readiness[]
              ).map((v) => [v, v])}
              onChange={(v) => {
                const ready = ['ready', 'pending', 'original-only', 'uninspectable', 'failed'].find(
                  (value) => value === v
                );
                if (
                  ready === 'ready' ||
                  ready === 'pending' ||
                  ready === 'original-only' ||
                  ready === 'uninspectable' ||
                  ready === 'failed'
                )
                  mutate({ readiness: ready });
              }}
            />
            <Choice
              label="Preview path"
              value={r.path}
              options={[
                ['sdr', 'Unqualified HDR path: explicit SDR'],
                ['hdr', 'Simulated qualified HDR path'],
                ['safari', 'Safari animated SDR WebP fallback'],
              ]}
              onChange={r.setPath}
            />
            <Choice
              label="Preview motion preference"
              value={r.still ? 'static' : 'animated'}
              options={[
                ['static', 'Prefer static previews'],
                ['animated', 'Allow animation'],
              ]}
              onChange={(v) => r.setStill(v === 'static')}
            />
            <Choice
              label="Delivery health"
              value={r.outage ? 'outage' : 'normal'}
              options={[
                ['normal', 'Normal'],
                ['outage', 'Temporary outage'],
              ]}
              onChange={(v) => r.setOutage(v === 'outage')}
            />
            <Choice
              label="Next rendition response"
              value={r.response}
              options={[
                ['normal', 'Normal'],
                ['503', '503 with Retry-After: 5'],
                ['422', '422 unsupported'],
                ['limits', '422 output limits'],
                ['400', '400 invalid selector'],
                ['404', '404 source unavailable'],
              ]}
              onChange={r.setResponse}
            />
            <Choice
              label="Current Profile picture"
              value={r.pictureAvailable ? 'yes' : 'no'}
              options={[
                ['yes', 'Available'],
                ['no', 'Retired: initials only'],
              ]}
              onChange={(v) => r.setPictureAvailable(v === 'yes')}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => mutate({ confirmed: !selected.confirmed })}
              >
                {selected.confirmed ? 'Remove' : 'Receive'} Media confirmation
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => mutate({ uploaded: !selected.uploaded })}
              >
                {selected.uploaded ? 'Remove' : 'Receive'} upload announcement
              </Button>
            </div>
            <details className="rounded-lg border p-3" open>
              <summary className="cursor-pointer text-sm">Current state and contract trace</summary>
              <dl className="mt-3 space-y-2 text-xs">
                <div>Asset: {selected.id}</div>
                <div>
                  Original confirmed: {String(selected.confirmed)} · uploaded:{' '}
                  {String(selected.uploaded)}
                </div>
                <div>
                  Source: {selected.width || 'unknown'} × {selected.height || 'unknown'} ·{' '}
                  {selected.format} · {selected.range || 'unknown'} · {selected.motion || 'unknown'}{' '}
                  · gamut {selected.gamut || 'unknown'} · {selected.depth || 'unknown'} bit · alpha{' '}
                  {selected.alpha === undefined ? 'unknown' : String(selected.alpha)}
                </div>
                <div>Original: /assets/{selected.id}</div>
                <div>Metadata: /assets/{selected.id}/metadata</div>
                <div>
                  Preview:{' '}
                  <code className="break-all">
                    {preview(selected, r.path, r.still)?.url || 'Placeholder; no image request'}
                  </code>
                </div>
                <div>
                  Limits: {limits.width} × {limits.height}, {limits.pixels.toLocaleString()} total
                  pixels
                </div>
                <div>
                  Inspection polling:{' '}
                  {selected.readiness === 'pending'
                    ? 'Bounded metadata checks honor Retry-After; then manual retry. Simulated here.'
                    : 'Terminal inspection failures do not poll or restart inspection.'}
                </div>
                <div>
                  Catalogue stays visible during delivery outages. Unknown facts fail only filters
                  needing them.
                </div>
                <div>
                  Inclusive 5% tolerance is accepted in #326. Open Browse review to settle preset
                  sizes, exact preset shapes and minimum dimensions under overrides.
                </div>
                <div>
                  Generation and selection policy remain with #256. These fixtures are not a
                  processing support matrix.
                </div>
              </dl>
            </details>
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm">Fixture combinations</summary>
              <p className="my-2 text-xs text-muted-foreground">
                Illustrative Media tuples, independent of stored outputs.
              </p>
              {combinations(selected).map((c, i) => (
                <p key={i} className="text-xs">
                  {c.format} · {c.range} · {c.motion} · {c.gamut} · {c.depth} bit ·{' '}
                  {c.transparency.join(', ')}
                </p>
              ))}
            </details>
            <p className="text-xs text-muted-foreground">
              Placeholder photography from Unsplash. Original source contracts and all rendition
              responses are simulated. No production UI or data mutations.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
const element = document.getElementById('root');
if (element) createRoot(element).render(<RouterProvider router={router} />);
