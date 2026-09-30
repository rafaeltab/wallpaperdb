// Throwaway: color-filter interactions on the browse page via ?prototype=colors&variant=A.
import { ArrowLeft, ArrowRight, Check, ChevronDown, Plus, RotateCcw, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { BrowseFilterPanel } from '@/components/browse-filter-panel';
import { useBrowseFilterPanel } from '@/components/browse-filter-panel-context';
import { Button } from '@/components/ui/button';
import { WallpaperGrid } from '@/components/WallpaperGrid';
import type { Wallpaper } from '@/lib/graphql/types';
import './prototype.css';

type Target = {
  id: number;
  hex: string;
  amount: number | null;
  quality: number;
  feature?: Feature;
};
type HSV = { h: number; s: number; v: number };
const variants = [
  {
    key: 'A',
    name: 'Inline strip',
    note: 'A compact filter strip. Open a color to fine-tune it without leaving the gallery.',
  },
  {
    key: 'B',
    name: 'Sidebar studio',
    note: 'Keep the picker and each color’s amount beside your results.',
  },
  {
    key: 'C',
    name: 'Palette workbench',
    note: 'Build your palette on a wide canvas, then refine each color independently.',
  },
  {
    key: 'D',
    name: 'Guided composer',
    note: 'Pick colors first. Add amounts and match preferences when you’re ready.',
  },
  {
    key: 'E',
    name: 'Floating editor',
    note: 'Keep the gallery in view and build your search in a floating panel.',
  },
  {
    key: 'F',
    name: 'Gradient composer',
    note: 'Drag composition boundaries in 10% steps. This guide describes amounts, not positions in the image.',
  },
  {
    key: 'G',
    name: 'Compact modal',
    note: 'Edit colors and visual features together in a modal, with match preferences per target.',
  },
  {
    key: 'H',
    name: 'Gradient modal',
    note: 'A full-width composition strip leads the modal. Select a segment to edit its color, feature or matching.',
  },
  {
    key: 'I',
    name: 'Inline gradient',
    note: 'Shape amounts directly in the filter section. Select a segment to open its focused editor.',
  },
  {
    key: 'J',
    name: 'Simple gradient',
    note: 'Every preference in one strip. Select a segment to edit it.',
  },
];
const presets = [
  '#F07991',
  '#E34F50',
  '#F4A259',
  '#E7CA72',
  '#A3BA80',
  '#468C78',
  '#68B5CE',
  '#5D80D6',
  '#8F79C7',
  '#CF8EBB',
  '#FFFFFF',
  '#A3A5AE',
  '#343641',
  '#10121B',
];
const qualityNames = ['Relaxed', 'Balanced', 'Strict'];
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
function toHex({ h, s, v }: HSV): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(
      255 * (v / 100 - (((v / 100) * s) / 100) * Math.max(0, Math.min(k, 4 - k, 1)))
    )
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`.toUpperCase();
}
function toHSV(hex: string): HSV {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255,
    g = Number.parseInt(hex.slice(3, 5), 16) / 255,
    b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  const h =
    d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

function CustomPicker({
  initial,
  onChoose,
  action = 'Add color',
  featureOptions,
  initialTab = 'Spectrum',
  live = false,
}: {
  initial: string;
  onChoose: (hex: string) => void;
  action?: string;
  featureOptions?: ReactNode;
  initialTab?: string;
  live?: boolean;
}) {
  const [hsv, setHSV] = useState(() => toHSV(initial));
  const [hexDraft, setHexDraft] = useState(initial);
  const [tab, setTab] = useState(initialTab);
  const field = useRef<HTMLDivElement>(null);
  const hex = toHex(hsv);
  const validHex = /^#[0-9a-f]{6}$/i.test(hexDraft);
  function update(next: HSV) {
    setHSV(next);
    setHexDraft(toHex(next));
    if (live) onChoose(toHex(next));
  }
  function pick(event: PointerEvent<HTMLDivElement>) {
    const rect = field.current?.getBoundingClientRect();
    if (!rect) return;
    update({
      ...hsv,
      s: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      v: 100 - clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
    });
  }
  const pickerTabs = (
    <div className="cp-picker-tabs">
      {['Spectrum', 'Swatches', ...(featureOptions ? ['Features'] : [])].map((name) => (
        <button type="button" key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>
          {name}
        </button>
      ))}
    </div>
  );
  if (tab === 'Features')
    return (
      <div className="cp-picker">
        {pickerTabs}
        {featureOptions}
      </div>
    );
  return (
    <div className="cp-picker">
      {pickerTabs}
      {tab === 'Spectrum' ? (
        <>
          <div
            ref={field}
            className="cp-spectrum"
            style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
            title="Drag to set saturation and brightness"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pick(e);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e);
            }}
          >
            <span
              className="cp-reticle"
              style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, background: hex }}
            />
          </div>
          <label className="cp-hue-label">
            <span>Hue</span>
            <input
              aria-label="Hue"
              className="cp-hue"
              type="range"
              min="0"
              max="359"
              value={hsv.h}
              onChange={(e) => update({ ...hsv, h: Number(e.target.value) })}
            />
          </label>
          <div className="cp-fine-controls">
            <label>
              Saturation
              <input
                aria-label="Saturation"
                type="range"
                min="0"
                max="100"
                value={hsv.s}
                onChange={(e) => update({ ...hsv, s: Number(e.target.value) })}
              />
            </label>
            <label>
              Brightness
              <input
                aria-label="Brightness"
                type="range"
                min="0"
                max="100"
                value={hsv.v}
                onChange={(e) => update({ ...hsv, v: Number(e.target.value) })}
              />
            </label>
          </div>
        </>
      ) : (
        <div className="cp-swatch-library">
          {presets.map((color) => (
            <button
              type="button"
              key={color}
              aria-label={`Choose ${color}`}
              aria-pressed={hex === color}
              style={{ background: color }}
              onClick={() => update(toHSV(color))}
            >
              {hex === color && <Check size={18} />}
            </button>
          ))}
        </div>
      )}
      <div className="cp-hex-row">
        <span className="cp-preview-swatch" style={{ background: hex }} />
        <label>
          HEX
          <input
            aria-label="Hex color"
            value={hexDraft}
            aria-invalid={!validHex}
            spellCheck={false}
            maxLength={7}
            onChange={(e) => {
              const next = e.target.value.toUpperCase();
              setHexDraft(next);
              if (/^#[0-9A-F]{6}$/.test(next)) {
                setHSV(toHSV(next));
                if (live) onChoose(next);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && validHex) onChoose(hex);
            }}
          />
        </label>
        {!live && (
          <button
            type="button"
            className="cp-primary"
            disabled={!validHex}
            onClick={() => onChoose(hex)}
          >
            <Plus size={15} />
            {action}
          </button>
        )}
      </div>
      {!validHex && <p className="cp-validation">Enter a six-digit hex color, such as #5D80D6.</p>}
      <div className="cp-quick-swatches">
        {presets.slice(0, 10).map((color) => (
          <button
            type="button"
            key={color}
            aria-label={`Quick color ${color}`}
            style={{ background: color }}
            onClick={() => update(toHSV(color))}
          />
        ))}
      </div>
    </div>
  );
}

// Distribution features are whole-image preferences, not pixel-area allocations.
const features = [
  {
    key: 'grayscale',
    label: 'Grayscale',
    area: true,
    appearance: 'linear-gradient(135deg,#eee,#333)',
    description: 'Prefer pixels with little or no saturation.',
  },
  {
    key: 'strict_grayscale',
    label: 'Strict grayscale',
    area: true,
    appearance: 'linear-gradient(135deg,#fff,#000)',
    description: 'Prefer a stricter absence of color.',
  },
  {
    key: 'near_neutral',
    label: 'Near-neutral',
    area: true,
    appearance: '#b5b0aa',
    description: 'Prefer near-neutral pixels.',
  },
  {
    key: 'dark',
    label: 'Dark',
    area: true,
    appearance: '#242632',
    description: 'Prefer dark pixels.',
  },
  {
    key: 'light',
    label: 'Light',
    area: true,
    appearance: '#f5f1e5',
    description: 'Prefer light pixels.',
  },
  {
    key: 'vivid',
    label: 'Vivid',
    area: true,
    appearance: 'linear-gradient(135deg,#f13676,#634eff)',
    description: 'Prefer vivid, saturated pixels.',
  },
  {
    key: 'muted',
    label: 'Muted',
    area: true,
    appearance: '#a899ae',
    description: 'Prefer subdued colors.',
  },
  {
    key: 'monochromatic',
    label: 'Monochromatic',
    area: false,
    appearance: 'linear-gradient(135deg,#b4c5f1,#254572)',
    description: 'Prefer a narrow overall hue distribution. This does not measure an area.',
  },
  {
    key: 'rainbow',
    label: 'Rainbow',
    area: false,
    appearance: 'linear-gradient(90deg,#e85c79,#edcc6e,#69b29c,#6487d3)',
    description: 'Prefer a broad overall hue distribution. This does not measure an area.',
  },
] as const;
type Feature = (typeof features)[number];
const labelOf = (t: Target) => t.feature?.label ?? t.hex;
const appearanceOf = (t: Target) => t.feature?.appearance ?? t.hex;
const sampleWallpapers: Wallpaper[] = Array.from({ length: 8 }, (_, i) => ({
  wallpaperId: `prototype-${i + 1}`,
  profileId: 'prototype',
  uploadedAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
  variants: [
    {
      width: 900,
      height: 600,
      aspectRatio: 1.5,
      format: 'image/jpeg',
      fileSizeBytes: 100000,
      createdAt: '2026-09-30T00:00:00Z',
      url: `${import.meta.env.BASE_URL}color-filter-prototype/wallpaper-${i + 1}.jpg`,
    },
  ],
}));

// The real grid measures on window resize. Prototype layouts also resize its container.
function PrototypeGallery() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div className="cp-gallery" ref={container}>
      <WallpaperGrid wallpapers={sampleWallpapers} />
    </div>
  );
}

export default function ColorFilterPrototype() {
  const readVariant = () =>
    Math.max(
      0,
      variants.findIndex(
        (v) => v.key === (new URLSearchParams(window.location.search).get('variant') ?? 'J')
      )
    );
  const [variant, setVariant] = useState(readVariant);
  const [targets, setTargets] = useState<Target[]>([]);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [step, setStep] = useState(0);
  const [floatingOpen, setFloatingOpen] = useState(true);
  const [notice, setNotice] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const savedTargets = useRef<Target[]>([]);
  const nextId = useRef(0);
  const track = useRef<HTMLDivElement>(null);
  const simpleDrag = useRef<{ x: number; position: number; scale: number } | null>(null);
  const { isOpen, setIsOpen } = useBrowseFilterPanel();
  const [format, setFormat] = useState<'jpeg' | 'png' | 'webp' | undefined>();
  const [aspect, setAspect] = useState<
    import('@/lib/browse-filters').BrowseAspectRatioValue | undefined
  >();
  const [profile, setProfile] = useState<string | undefined>();
  const current = variants[variant];
  const isModalDesign = ['G', 'H', 'I', 'J'].includes(current.key);
  const used = targets.reduce((sum, t) => sum + (t.amount ?? 0), 0);
  const remaining = 100 - used;
  const quantified = targets.filter((t) => t.amount !== null);
  useEffect(() => {
    setIsOpen(true);
  }, [setIsOpen]);
  function switchVariant(index: number) {
    const next = (index + variants.length) % variants.length;
    const url = new URL(window.location.href);
    url.searchParams.set('variant', variants[next].key);
    window.history.pushState({}, '', url);
    setVariant(next);
    setEditing(null);
    setNotice('');
  }
  useEffect(() => {
    const pop = () => {
      setVariant(readVariant());
      setEditing(null);
    };
    const keyboard = (e: KeyboardEvent) => {
      if (modalOpen) return;
      if (e.key === 'Escape') {
        setEditing(null);
        return;
      }
      if (
        e.target instanceof HTMLElement &&
        (e.target.closest('input, textarea, select, button, [contenteditable="true"]') ||
          e.altKey ||
          e.ctrlKey ||
          e.metaKey)
      )
        return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        switchVariant(variant + (e.key === 'ArrowLeft' ? -1 : 1));
      }
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('keydown', keyboard);
    };
  });
  function choose(hex: string) {
    if (targets.some((t) => t.hex === hex && t.id !== editing)) {
      setNotice('That color is already selected.');
      return;
    }
    const id = typeof editing === 'number' ? editing : nextId.current++;
    if (typeof editing === 'number')
      setTargets((old) => old.map((t) => (t.id === id ? { ...t, hex, feature: undefined } : t)));
    else setTargets((old) => [...old, { id, hex, amount: null, quality: 1 }]);
    setNotice('');
    setEditing(['I', 'J'].includes(current.key) ? id : null);
  }
  function updateAmount(id: number, amount: number | null) {
    setTargets((old) => {
      const available = 100 - old.reduce((sum, t) => sum + (t.id === id ? 0 : (t.amount ?? 0)), 0);
      return old.map((t) =>
        t.id === id
          ? {
              ...t,
              amount: amount === null ? null : clamp(Math.round(amount / 10) * 10, 0, available),
            }
          : t
      );
    });
  }
  function remove(id: number) {
    setTargets((old) => old.filter((t) => t.id !== id));
    if (editing === id) setEditing(null);
  }
  function toggleFeature(feature: Feature) {
    if (current.key === 'J' && typeof editing === 'number') {
      if (targets.some((t) => t.id !== editing && t.feature?.key === feature.key)) {
        setNotice('That feature is already selected.');
        return;
      }
      setTargets((old) =>
        old.map((t) =>
          t.id === editing
            ? { ...t, hex: feature.key, feature, amount: feature.area ? t.amount : null }
            : t
        )
      );
      setNotice('');
      return;
    }
    const existing = targets.find((t) => t.feature?.key === feature.key);
    if (existing) remove(existing.id);
    else {
      const id = nextId.current++;
      setTargets((old) => [...old, { id, hex: feature.key, feature, amount: null, quality: 1 }]);
      if (current.key === 'I') setEditing(id);
    }
  }
  function renderAmount(target: Target) {
    if (target.feature && !target.feature.area)
      return <small className="cp-muted">Whole-image preference</small>;
    const available = remaining + (target.amount ?? 0);
    return (
      <div className="cp-amount">
        <button
          type="button"
          className={target.amount === null ? 'cp-amount-toggle' : 'cp-amount-toggle is-set'}
          aria-label={`Amount for ${labelOf(target)}`}
          disabled={target.amount === null && remaining === 0}
          title={
            target.amount === null && remaining === 0
              ? 'Clear or lower another amount to make room.'
              : 'Add or clear an optional percentage'
          }
          onClick={() =>
            updateAmount(target.id, target.amount === null ? Math.min(40, remaining) : null)
          }
        >
          {target.amount === null ? 'Any amount' : `About ${target.amount}%`}
          <ChevronDown size={13} />
        </button>
        {target.amount !== null && (
          <div className="cp-amount-slider">
            <input
              aria-label={`Percentage for ${labelOf(target)}`}
              type="range"
              min="0"
              max={available}
              step="10"
              value={target.amount}
              onChange={(e) => updateAmount(target.id, Number(e.target.value))}
            />
            <small>Max {available}%</small>
            <button
              type="button"
              aria-label={`Clear percentage for ${labelOf(target)}`}
              onClick={() => updateAmount(target.id, null)}
            >
              <RotateCcw size={13} />
            </button>
          </div>
        )}
      </div>
    );
  }
  function renderTarget(target: Target, card = false) {
    return (
      <div
        key={target.id}
        className={`${card ? 'cp-target cp-target-card' : 'cp-target'} ${editing === target.id ? 'is-editing' : ''}`}
      >
        {target.feature ? (
          <button
            type="button"
            className="cp-color-button"
            style={{ background: appearanceOf(target) }}
            aria-label={`Edit ${labelOf(target)}`}
            onClick={() => setEditing(target.id)}
          />
        ) : (
          <button
            type="button"
            className="cp-color-button"
            aria-label={`Edit ${target.hex}`}
            style={{ background: target.hex }}
            onClick={() => setEditing(target.id)}
          />
        )}
        <div className="cp-target-info">
          <span className="cp-hex-name">{labelOf(target)}</span>
          <div className="cp-row-controls">
            {renderAmount(target)}
            {renderTargetQuality(target)}
          </div>
        </div>
        <button
          type="button"
          className="cp-icon-button cp-remove"
          aria-label={`Remove ${labelOf(target)}`}
          onClick={() => remove(target.id)}
        >
          <X size={15} />
        </button>
      </div>
    );
  }
  function renderTargetQuality(target: Target) {
    if (current.key === 'J')
      return (
        <label className="cp-match-slider">
          <span>
            Match <small>{qualityNames[target.quality]}</small>
          </span>
          <input
            type="range"
            min="0"
            max="2"
            step="1"
            value={target.quality}
            aria-label={`Match preference for ${labelOf(target)}`}
            aria-valuetext={qualityNames[target.quality]}
            onChange={(e) => {
              const quality = Number(e.target.value);
              setTargets((old) => old.map((t) => (t.id === target.id ? { ...t, quality } : t)));
            }}
          />
        </label>
      );
    return (
      <label className="cp-target-quality">
        <span>Match</span>
        <select
          aria-label={`Match preference for ${labelOf(target)}`}
          value={target.quality}
          onChange={(e) => {
            const quality = Number(e.target.value);
            setTargets((old) => old.map((t) => (t.id === target.id ? { ...t, quality } : t)));
          }}
        >
          {qualityNames.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  function renderPicker(always = false) {
    const target = targets.find((t) => t.id === editing);
    return (
      <div className="cp-picker-container">
        <div className="cp-field-heading">
          <span>{target ? `Edit ${labelOf(target)}` : 'Choose a color or feature'}</span>
          {!always && (
            <button
              type="button"
              className="cp-icon-button"
              aria-label="Close picker"
              onClick={() => setEditing(null)}
            >
              <X size={16} />
            </button>
          )}
        </div>
        <CustomPicker
          key={`${target?.id ?? 'new'}:${target?.feature?.key ?? 'color'}`}
          initial={target?.feature ? '#5D80D6' : (target?.hex ?? '#5D80D6')}
          featureOptions={renderFeatures()}
          initialTab={target?.feature ? 'Features' : 'Spectrum'}
          onChoose={choose}
          live={current.key === 'J'}
          action={target ? 'Save color' : 'Add color'}
        />
        {notice && <output className="cp-validation">{notice}</output>}
      </div>
    );
  }
  const addButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        setEditing('new');
        setFloatingOpen(true);
      }}
    >
      <Plus size={15} />
      Add color or feature
    </Button>
  );
  const rows = targets.length ? (
    targets.map((t) => renderTarget(t))
  ) : (
    <p className="cp-empty">Choose a color or a visual feature. Amounts are optional.</p>
  );
  const budget = (
    <div className="cp-budget" aria-live="polite">
      <span>
        <strong>{used}%</strong> specified
      </span>
      <span>
        {remaining === 0
          ? 'Fully specified · lower an amount to add another'
          : `${remaining}% left unconstrained`}
      </span>
      <div className="cp-budget-meter">
        <span style={{ width: `${used}%` }} />
      </div>
    </div>
  );
  const hint = (
    <p className="cp-hint">
      Amounts share a 100% budget and use 10% steps. Colors and area-based features may overlap in
      the actual image.
    </p>
  );
  function renderFeatures() {
    return (
      <div className="cp-feature-library">
        {features.map((f) => (
          <button
            type="button"
            key={f.key}
            className="cp-feature-choice"
            aria-label={f.label}
            aria-pressed={targets.some(
              (t) => t.feature?.key === f.key && (current.key !== 'J' || t.id === editing)
            )}
            onClick={() => toggleFeature(f)}
          >
            <span className="cp-feature-dot" style={{ background: f.appearance }} />
            <span>
              <strong>{f.label}</strong>
              <small>{f.description}</small>
            </span>
            {targets.some(
              (t) => t.feature?.key === f.key && (current.key !== 'J' || t.id === editing)
            ) && <Check size={15} />}
          </button>
        ))}
        <p className="cp-hint">
          Monochromatic and rainbow are whole-image preferences with no area percentage.
        </p>
      </div>
    );
  }
  function openModal(targetId?: number) {
    savedTargets.current = targets;
    if (current.key === 'J' && targetId === undefined) {
      const id = nextId.current++;
      const hex =
        ['#5D80D6', ...presets].find((color) => !targets.some((t) => t.hex === color)) ?? '#5D80D6';
      setTargets((old) => [...old, { id, hex, amount: null, quality: 1 }]);
      setEditing(id);
    } else setEditing(targetId ?? (current.key === 'I' ? (targets[0]?.id ?? 'new') : 'new'));
    setNotice('');
    setModalOpen(true);
  }
  function selectGradientTarget(id: number) {
    if (modalOpen) setEditing(id);
    else openModal(id);
  }
  function renderVibeTargets() {
    const vibes = targets.filter((t) => t.amount === null);
    if (!vibes.length) return null;
    return (
      <div className="cp-vibe-targets">
        <span>Without an amount</span>
        {vibes.map((t) => (
          <Button
            key={t.id}
            variant={editing === t.id ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => selectGradientTarget(t.id)}
          >
            <span className="cp-feature-dot" style={{ background: appearanceOf(t) }} />
            {labelOf(t)}
            <small>{qualityNames[t.quality]}</small>
          </Button>
        ))}
      </div>
    );
  }
  function renderModal() {
    if (current.key === 'J') return renderSimpleModal();
    const focusedTarget = targets.find((t) => t.id === editing);
    return (
      <Dialog.Root
        open={modalOpen}
        onOpenChange={(open) => {
          if (open) openModal();
          else {
            setTargets(savedTargets.current);
            setModalOpen(false);
            setEditing(null);
            setNotice('');
          }
        }}
      >
        <div className={`cp-modal-entry cp-entry-${current.key}`}>
          <div className="cp-compact-strip">
            <div className="cp-compact-label">
              <strong>Color search</strong>
              <span>
                {targets.length === 0
                  ? 'Colors, grayscale, dark and more'
                  : `${targets.length} preferences${used > 0 ? ` · ${used}% specified` : ''}`}
              </span>
            </div>
            <div className="cp-compact-chips">
              {targets.map((t) => (
                <Button key={t.id} variant="outline" size="sm" onClick={() => openModal(t.id)}>
                  <span className="cp-feature-dot" style={{ background: appearanceOf(t) }} />
                  {labelOf(t)}
                  {t.amount !== null && ` · ${t.amount}%`}
                  <small>{qualityNames[t.quality]}</small>
                </Button>
              ))}
            </div>
            <Dialog.Trigger asChild>
              <Button variant="outline" size="sm">
                <Plus size={15} />
                {targets.length ? 'Edit preferences' : 'Add color or feature'}
              </Button>
            </Dialog.Trigger>
          </div>
          {current.key === 'I' && (
            <div className="cp-inline-composition">
              {renderGradient(true, true)}
              {renderVibeTargets()}
            </div>
          )}
        </div>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
          <Dialog.Content
            className={`cp-app cp-modal cp-modal-${current.key} fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 border bg-background shadow-2xl outline-none`}
          >
            <div className="cp-modal-heading">
              <div>
                <Dialog.Title className="text-lg font-semibold">
                  {current.key === 'I'
                    ? 'Edit color or feature'
                    : current.key === 'H'
                      ? 'Compose your color search'
                      : 'Color search'}
                </Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  Combine colors and visual features. Amounts are optional.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close color search">
                  <X size={17} />
                </Button>
              </Dialog.Close>
            </div>
            <div className="cp-modal-scroll">
              {current.key === 'H' && (
                <section className="cp-modal-gradient">
                  {renderGradient(true)}
                  {renderVibeTargets()}
                  <div className="cp-gradient-budget">
                    <span>{used}% specified</span>
                    <span>{remaining}% left unconstrained</span>
                  </div>
                </section>
              )}
              <div className="cp-modal-body">
                <section className="cp-modal-selection">
                  <div className="cp-field-heading">
                    <span>Your preferences</span>
                    <small>{targets.length} selected</small>
                  </div>
                  {current.key === 'I' ? (
                    <>
                      <div className="cp-focus-targets">
                        {targets.map((t) => (
                          <Button
                            key={t.id}
                            variant={editing === t.id ? 'secondary' : 'outline'}
                            size="sm"
                            onClick={() => setEditing(t.id)}
                          >
                            <span
                              className="cp-feature-dot"
                              style={{ background: appearanceOf(t) }}
                            />
                            {labelOf(t)}
                          </Button>
                        ))}
                      </div>
                      {focusedTarget ? (
                        renderTarget(focusedTarget)
                      ) : (
                        <p className="cp-empty">
                          Choose a color or feature in the picker to add a target.
                        </p>
                      )}
                    </>
                  ) : (
                    rows
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="cp-modal-add"
                    onClick={() => setEditing('new')}
                  >
                    <Plus size={15} />
                    Add color or feature
                  </Button>
                  {used > 0 && budget}
                  {used > 0 && hint}
                  {current.key === 'G' && (
                    <details className="cp-modal-composition">
                      <summary>Composition guide</summary>
                      {renderGradient()}
                    </details>
                  )}
                </section>
                <section className="cp-modal-picker" aria-label="Color and feature picker">
                  {renderPicker(true)}
                </section>
              </div>
            </div>
            <div className="cp-modal-footer">
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                size="sm"
                onClick={() => {
                  savedTargets.current = targets;
                  setModalOpen(false);
                  setEditing(null);
                  setNotice('');
                }}
              >
                Apply preferences
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
  function renderSimpleGradient() {
    const unquantified = targets.filter((t) => t.amount === null).length;
    const share = unquantified ? Math.max(remaining / unquantified, 12) : 0;
    const zeroCount = targets.filter((t) => t.amount === 0).length;
    const zeroWidth = Math.min(8, 100 / Math.max(targets.length, 1));
    const free = unquantified ? 0 : remaining;
    const flexibleTotal = targets.reduce((sum, t) => sum + (t.amount ?? share), 0) + free;
    const scale = flexibleTotal > 0 ? (100 - zeroCount * zeroWidth) / flexibleTotal : 1;
    const weights = targets.map((t) => (t.amount === 0 ? zeroWidth : (t.amount ?? share) * scale));
    const total = weights.reduce((sum, weight) => sum + weight, 0) + free * scale;
    return (
      <div className="cp-simple-gradient" ref={track}>
        <div className="cp-simple-segments">
          {targets.map((t, index) => (
            <div
              key={t.id}
              className="cp-simple-segment"
              style={{ flexGrow: weights[index], background: appearanceOf(t) }}
            >
              <button
                type="button"
                className="cp-simple-edit"
                aria-label={`Edit ${labelOf(t)}`}
                onClick={() => openModal(t.id)}
              >
                <span>{labelOf(t)}</span>
                {t.amount !== null && <small>{t.amount}%</small>}
              </button>
              <button
                type="button"
                className="cp-simple-remove"
                aria-label={`Remove ${labelOf(t)}`}
                onClick={() => remove(t.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {!unquantified && remaining > 0 && (
            <div className="cp-simple-free" style={{ flexGrow: free * scale }} />
          )}
        </div>
        {targets.map((t, index) => {
          if (t.amount === null) return null;
          const before = weights.slice(0, index).reduce((sum, weight) => sum + weight, 0);
          const position = ((before + weights[index]) / total) * 100;
          const quantifiedIndex = quantified.findIndex((q) => q.id === t.id);
          const quantifiedBefore = quantified
            .slice(0, quantifiedIndex)
            .reduce((sum, q) => sum + (q.amount ?? 0), 0);
          return (
            <button
              key={t.id}
              type="button"
              role="slider"
              className="cp-gradient-handle"
              style={{ left: `${position}%` }}
              aria-label={`Amount boundary for ${labelOf(t)}`}
              aria-valuemin={0}
              aria-valuemax={
                (t.amount ?? 0) + (quantified[quantifiedIndex + 1]?.amount ?? remaining)
              }
              aria-valuenow={t.amount}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                simpleDrag.current = {
                  x: e.clientX,
                  position: quantifiedBefore + (t.amount ?? 0),
                  scale,
                };
              }}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const rect = track.current?.getBoundingClientRect();
                const start = simpleDrag.current;
                if (rect && start)
                  adjustBoundary(
                    quantifiedIndex,
                    start.position + (((e.clientX - start.x) / rect.width) * 100) / start.scale
                  );
              }}
              onPointerUp={() => {
                simpleDrag.current = null;
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  adjustBoundary(
                    quantifiedIndex,
                    quantifiedBefore + (t.amount ?? 0) + (e.key === 'ArrowRight' ? 10 : -10)
                  );
                }
              }}
            >
              <span />
            </button>
          );
        })}
      </div>
    );
  }
  function renderSimpleModal() {
    const target = targets.find((t) => t.id === editing);
    const adding = !savedTargets.current.some((t) => t.id === editing);
    return (
      <Dialog.Root
        open={modalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setTargets(savedTargets.current);
            setModalOpen(false);
            setEditing(null);
            setNotice('');
          }
        }}
      >
        <div className="cp-simple-entry">
          <div className="cp-simple-heading">
            <strong>Color</strong>
            <Button variant="outline" size="sm" onClick={() => openModal()}>
              <Plus size={15} />
              Add color or feature
            </Button>
          </div>
          {renderSimpleGradient()}
        </div>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
          <Dialog.Content
            className="cp-app cp-modal cp-modal-J fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 border bg-background shadow-2xl outline-none"
            aria-describedby={undefined}
          >
            <div className="cp-modal-heading">
              <Dialog.Title>
                {adding ? 'Add color or feature' : 'Edit color or feature'}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close editor">
                  <X size={17} />
                </Button>
              </Dialog.Close>
            </div>
            <div className="cp-simple-modal-body">
              {renderPicker(true)}
              <div className="cp-simple-controls">
                {target && (
                  <>
                    {renderAmount(target)}
                    {renderTargetQuality(target)}
                  </>
                )}
              </div>
            </div>
            <div className="cp-modal-footer">
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                size="sm"
                onClick={() => {
                  savedTargets.current = targets;
                  setModalOpen(false);
                  setEditing(null);
                  setNotice('');
                }}
              >
                Save
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
  function renderGallery() {
    return <PrototypeGallery />;
  }
  function adjustBoundary(index: number, position: number) {
    const target = quantified[index],
      next = quantified[index + 1];
    const before = quantified.slice(0, index).reduce((sum, t) => sum + (t.amount ?? 0), 0);
    const shared = (target.amount ?? 0) + (next?.amount ?? remaining);
    const amount = clamp(Math.round(position / 10) * 10 - before, 0, shared);
    setTargets((old) =>
      old.map((t) =>
        t.id === target.id
          ? { ...t, amount }
          : next && t.id === next.id
            ? { ...t, amount: shared - amount }
            : t
      )
    );
  }
  function renderGradient(selectable = false, compact = false) {
    let cursor = 0;
    const stops = quantified.flatMap((t) => {
      const start = cursor;
      cursor += t.amount ?? 0;
      const color = t.feature
        ? t.feature.key === 'light'
          ? '#eee'
          : t.feature.key === 'dark'
            ? '#252530'
            : t.feature.key === 'vivid'
              ? '#e35d8c'
              : t.feature.key === 'muted'
                ? '#a899ae'
                : t.feature.key === 'near_neutral'
                  ? '#b5b0aa'
                  : '#aaa'
        : t.hex;
      return [`${color} ${start}%`, `${color} ${cursor}%`];
    });
    if (remaining > 0) stops.push(`var(--muted) ${used}%`, 'var(--muted) 100%');
    const gradient = stops.length ? `linear-gradient(90deg,${stops.join(',')})` : 'var(--muted)';
    return (
      <div className={`cp-gradient-editor ${compact ? 'cp-gradient-compact' : ''}`}>
        <div className="cp-field-heading">
          <span>Composition guide</span>
          <small>Drag handles · 10% steps</small>
        </div>
        <div className="cp-gradient-track" ref={track} style={{ background: gradient }}>
          <div className="cp-gradient-labels">
            {quantified.map((t) =>
              selectable ? (
                <button
                  key={t.id}
                  type="button"
                  className={editing === t.id ? 'cp-segment is-selected' : 'cp-segment'}
                  aria-label={`Edit composition target ${labelOf(t)}`}
                  title={`${labelOf(t)} · ${t.amount}% · ${qualityNames[t.quality]}`}
                  style={{ width: `${t.amount}%` }}
                  onClick={() => selectGradientTarget(t.id)}
                >
                  {t.amount !== 0 && (
                    <>
                      <strong>{t.amount}%</strong>
                      <small>{labelOf(t)}</small>
                    </>
                  )}
                </button>
              ) : (
                <span key={t.id} style={{ width: `${t.amount}%` }}>
                  {t.amount !== 0 && `${t.amount}%`}
                </span>
              )
            )}
            {remaining > 0 && (
              <span className="cp-gradient-free" style={{ width: `${remaining}%` }}>
                {remaining}% free
              </span>
            )}
          </div>
          {quantified.map((t, index) => {
            const position = quantified
              .slice(0, index + 1)
              .reduce((sum, item) => sum + (item.amount ?? 0), 0);
            const before = position - (t.amount ?? 0);
            const max = position + (quantified[index + 1]?.amount ?? remaining);
            return (
              <button
                key={t.id}
                type="button"
                role="slider"
                aria-label={`Composition boundary after ${labelOf(t)}`}
                aria-valuemin={before}
                aria-valuemax={max}
                aria-valuenow={position}
                aria-valuetext={`${t.amount}% ${labelOf(t)}`}
                className="cp-gradient-handle"
                style={{ left: `${position}%` }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  const rect = track.current?.getBoundingClientRect();
                  if (rect) adjustBoundary(index, ((e.clientX - rect.left) / rect.width) * 100);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    adjustBoundary(index, position + (e.key === 'ArrowRight' ? 10 : -10));
                  } else if (e.key === 'Home' || e.key === 'End') {
                    e.preventDefault();
                    adjustBoundary(index, e.key === 'Home' ? before : max);
                  }
                }}
              >
                <span />
              </button>
            );
          })}
        </div>
        <div className="cp-gradient-ruler">
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
        <p className="cp-hint">
          This represents requested amounts, not a spatial gradient in the wallpaper. Add a
          percentage to place a color or feature on the guide.
        </p>
      </div>
    );
  }
  function renderEditor() {
    if (current.key === 'A')
      return (
        <section className="cp-inline-panel">
          <div className="cp-inline-top">
            <div>
              <h2>Colors</h2>
              <p>Choose colors, then add optional amounts.</p>
            </div>
          </div>
          <div className="cp-strip">
            {targets.map((t) => renderTarget(t))}
            {addButton}
          </div>
          {budget}
          {hint}
          {editing !== null && <div className="cp-inline-picker">{renderPicker()}</div>}
        </section>
      );
    if (current.key === 'B')
      return (
        <aside className="cp-studio">
          <h2>Color studio</h2>
          {renderPicker(true)}
          <div className="cp-section-title">Selected targets · {targets.length}</div>
          {rows}
          {budget}
        </aside>
      );
    if (current.key === 'C')
      return (
        <section className="cp-workbench">
          <div className="cp-workbench-heading">
            <div>
              <h2>Build your palette</h2>
              <p>Colors and visual features, with optional amounts.</p>
            </div>
          </div>
          <div className="cp-workbench-body">
            <div className="cp-palette-cards">
              {targets.map((t) => renderTarget(t, true))}
              <button type="button" className="cp-add-card" onClick={() => setEditing('new')}>
                <Plus size={24} />
                Add color
              </button>
            </div>
            {renderPicker(true)}
          </div>
          {budget}
          {hint}
        </section>
      );
    if (current.key === 'D')
      return (
        <section className="cp-guided">
          <nav aria-label="Color composition steps">
            {['Pick colors', 'Set amounts', 'Tune matching'].map((name, i) => (
              <Button
                key={name}
                variant={step === i ? 'secondary' : 'ghost'}
                size="sm"
                aria-current={step === i ? 'step' : undefined}
                onClick={() => {
                  setStep(i);
                  setEditing(null);
                }}
              >
                {i + 1}. {name}
              </Button>
            ))}
          </nav>
          <div className="cp-guided-body">
            <div className="cp-guide-copy">
              <h2>
                {['Choose your colors', 'Add optional amounts', 'Tune your preferences'][step]}
              </h2>
              <p>
                {
                  [
                    'Use the picker and the visual feature buttons above.',
                    'Leave any target unquantified, or give it a share of the 100% budget.',
                    'Choose relaxed, balanced or strict matching separately for each target.',
                  ][step]
                }
              </p>
              {budget}
              {hint}
            </div>
            <div className="cp-guide-controls">
              {step === 0 ? (
                <>
                  {renderPicker(true)}
                  {rows}
                </>
              ) : step === 1 ? (
                <>
                  {rows}
                  {addButton}
                  {editing !== null && renderPicker()}
                </>
              ) : (
                rows
              )}
            </div>
          </div>
          <footer>
            <Button
              variant="ghost"
              size="sm"
              disabled={step === 0}
              onClick={() => setStep(step - 1)}
            >
              Back
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setStep(step === 2 ? 0 : step + 1);
                setEditing(null);
              }}
            >
              {step === 2 ? 'Edit colors' : step === 0 ? 'Add optional amounts' : 'Tune matching'}
              <ArrowRight size={14} />
            </Button>
          </footer>
        </section>
      );
    if (current.key === 'E')
      return floatingOpen ? (
        <aside className="cp-floating-panel">
          <div className="cp-field-heading">
            <h2>Color preferences</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Collapse color editor"
              onClick={() => setFloatingOpen(false)}
            >
              <ChevronDown size={16} />
            </Button>
          </div>
          {rows}
          {budget}
          {renderPicker(true)}
        </aside>
      ) : (
        <Button className="cp-floating-reopen" onClick={() => setFloatingOpen(true)}>
          Edit palette
        </Button>
      );
    return (
      <section className="cp-gradient-panel">
        <div className="cp-inline-top">
          <div>
            <h2>Composition editor</h2>
            <p>Add colors or features, then shape their amounts.</p>
          </div>
        </div>
        {renderGradient()}
        {budget}
        <div className="cp-gradient-body">
          <div>
            {rows}
            {addButton}
          </div>
          {renderPicker(true)}
        </div>
      </section>
    );
  }
  const withinPanel = !['B', 'E'].includes(current.key);
  return (
    <div className={`cp-app cp-variant-${current.key} ${modalOpen ? 'cp-modal-open' : ''}`}>
      {
        <BrowseFilterPanel
          isOpen={isOpen}
          draftColor="#FFFFFF"
          deviceAspectRatioPreset="16-9"
          selectedFormat={format}
          selectedAspectRatio={aspect}
          selectedProfileId={profile}
          onProfileChange={setProfile}
          onClearColor={() => {}}
          onColorInputChange={() => {}}
          onFormatChange={setFormat}
          onAspectRatioChange={setAspect}
          colorEditor={
            isOpen ? (
              <>
                <div className="cp-study-note">
                  <span>
                    Prototype {current.key} · {current.name}
                  </span>
                  <p>{current.note}</p>
                </div>
                {isModalDesign ? renderModal() : withinPanel && renderEditor()}
              </>
            ) : undefined
          }
        />
      }
      {current.key === 'B' ? (
        <div className={isOpen ? 'cp-sidebar-layout' : 'cp-browse-gallery'}>
          {isOpen && renderEditor()}
          {renderGallery()}
        </div>
      ) : current.key === 'E' ? (
        <div className="cp-floating-layout">
          {renderGallery()}
          {isOpen && renderEditor()}
        </div>
      ) : (
        renderGallery()
      )}
      <details className="cp-state">
        <summary>Inspect prototype query · {targets.length} targets · per-target matching</summary>
        <p>
          Sample wallpaper data uses the actual app grid. Color preferences stay in memory and are
          not sent to the backend. The 100% cap is an interface rule; ADR measurements can overlap.
        </p>
        <pre>
          {JSON.stringify(
            {
              specifiedPercent: used,
              unconstrainedPercent: remaining,
              targets: targets.map((t) => ({
                ...(t.feature ? { feature: t.hex } : { color: t.hex }),
                matchPreference: ['relaxed', 'balanced', 'strict'][t.quality],
                mode: t.amount === null ? 'vibe' : 'proportion',
                ...(t.amount !== null ? { proportion: t.amount / 100 } : {}),
              })),
            },
            null,
            2
          )}
        </pre>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setTargets([]);
            setEditing(null);
            setNotice('');
          }}
        >
          Reset preferences
        </Button>
      </details>
      <nav className="cp-switcher" aria-label="Prototype variant switcher">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous variant"
          onClick={() => switchVariant(variant - 1)}
        >
          <ArrowLeft size={16} />
        </Button>
        <div>
          <small>
            PROTOTYPE {variant + 1} / {variants.length}
          </small>
          <span>
            {current.key} · {current.name}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next variant"
          onClick={() => switchVariant(variant + 1)}
        >
          <ArrowRight size={16} />
        </Button>
        <div className="cp-variant-dots">
          {variants.map((v, i) => (
            <Button
              key={v.key}
              variant={variant === i ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label={`Variant ${v.key}: ${v.name}`}
              aria-pressed={variant === i}
              onClick={() => switchVariant(i)}
            >
              {v.key}
            </Button>
          ))}
        </div>
      </nav>
    </div>
  );
}
