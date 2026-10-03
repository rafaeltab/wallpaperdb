import { Check } from 'lucide-react';
import { useId, useState } from 'react';
import { COLOR_TARGETS, type ColorPreference } from '@/features/browse';

type Hsv = { h: number; s: number; v: number };
function hexToHsv(hex: string): Hsv {
  const [r, g, b] = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  );
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  const hue =
    delta === 0
      ? 0
      : max === r
        ? ((g - b) / delta + 6) % 6
        : max === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
  return { h: hue * 60, s: max === 0 ? 0 : (delta / max) * 100, v: max * 100 };
}
function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (offset: number) => {
    const k = (offset + h / 60) % 6;
    return Math.round(
      255 * (v / 100 - (((v / 100) * s) / 100) * Math.max(0, Math.min(k, 4 - k, 1)))
    )
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`.toUpperCase();
}
export function ColorPicker({
  initial,
  onChoose,
  onValidChange,
}: {
  initial: ColorPreference;
  onChoose: (target: { color: string } | { name: NonNullable<ColorPreference['name']> }) => void;
  onValidChange: (valid: boolean) => void;
}) {
  const prefix = useId();
  const named = COLOR_TARGETS.find((option) => option.name === initial.name);
  const initialHex =
    initial.color ?? (named?.appearance.startsWith('#') ? named.appearance : '#5D80D6');
  const [hsv, setHsv] = useState(() => hexToHsv(initialHex));
  const [hex, setHex] = useState(initialHex);
  const [selectedName, setSelectedName] = useState(initial.name);
  const [tab, setTab] = useState(named?.category ?? 'Spectrum');
  const valid = /^#[0-9a-f]{6}$/i.test(hex);
  function changeSpectrum(next: Hsv) {
    const color = hsvToHex(next);
    setHsv(next);
    setHex(color);
    setSelectedName(undefined);
    onValidChange(true);
    onChoose({ color });
  }
  return (
    <div className="color-picker">
      <div role="tablist" aria-label="Color picker" className="color-picker-tabs">
        {['Spectrum', 'Swatches', 'Features'].map((name) => (
          <button
            type="button"
            key={name}
            role="tab"
            id={`${prefix}-${name}`}
            aria-controls={`${prefix}-panel`}
            aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
            onKeyDown={(e) => {
              const tabs = ['Spectrum', 'Swatches', 'Features'];
              const index = tabs.indexOf(name);
              const next =
                e.key === 'ArrowRight'
                  ? tabs[(index + 1) % 3]
                  : e.key === 'ArrowLeft'
                    ? tabs[(index + 2) % 3]
                    : e.key === 'Home'
                      ? tabs[0]
                      : e.key === 'End'
                        ? tabs[2]
                        : undefined;
              if (next) {
                e.preventDefault();
                setTab(next);
                document.getElementById(`${prefix}-${next}`)?.focus();
              }
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${prefix}-panel`} aria-labelledby={`${prefix}-${tab}`}>
        {tab === 'Spectrum' ? (
          <>
            <div
              className="color-spectrum"
              aria-hidden="true"
              style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const rect = e.currentTarget.getBoundingClientRect();
                changeSpectrum({
                  ...hsv,
                  s: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
                  v: 100 - Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
                });
              }}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const rect = e.currentTarget.getBoundingClientRect();
                changeSpectrum({
                  ...hsv,
                  s: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
                  v: 100 - Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
                });
              }}
            >
              <span
                className="color-reticle"
                style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, background: hsvToHex(hsv) }}
              />
            </div>
            <label className="color-hue-label">
              Hue
              <input
                type="range"
                step="any"
                className="color-hue"
                min="0"
                max="359"
                value={hsv.h}
                onChange={(e) => changeSpectrum({ ...hsv, h: Number(e.target.value) })}
              />
            </label>
            <div className="color-fine-controls">
              <label>
                Saturation
                <input
                  type="range"
                  step="any"
                  min="0"
                  max="100"
                  value={hsv.s}
                  onChange={(e) => changeSpectrum({ ...hsv, s: Number(e.target.value) })}
                />
              </label>
              <label>
                Brightness
                <input
                  type="range"
                  step="any"
                  min="0"
                  max="100"
                  value={hsv.v}
                  onChange={(e) => changeSpectrum({ ...hsv, v: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="color-hex-row">
              <span className="color-preview" style={{ background: hsvToHex(hsv) }} />
              <label>
                HEX
                <input
                  aria-label="Hex color"
                  value={hex}
                  aria-invalid={!valid}
                  spellCheck={false}
                  maxLength={7}
                  onChange={(e) => {
                    const color = e.target.value.toUpperCase();
                    const isValid = /^#[0-9a-f]{6}$/i.test(color);
                    setHex(color);
                    onValidChange(isValid);
                    if (isValid) {
                      setHsv(hexToHsv(color));
                      setSelectedName(undefined);
                      onChoose({ color });
                    }
                  }}
                />
              </label>
            </div>
            {!valid && (
              <p role="alert" className="color-error">
                Use a six-digit hex color.
              </p>
            )}
          </>
        ) : (
          <div className="color-option-library">
            {COLOR_TARGETS.filter((option) => option.category === tab).map((option) => (
              <button
                type="button"
                key={option.name}
                aria-pressed={selectedName === option.name}
                onClick={() => {
                  setSelectedName(option.name);
                  onValidChange(true);
                  onChoose({ name: option.name });
                  if (option.appearance.startsWith('#')) {
                    setHsv(hexToHsv(option.appearance));
                    setHex(option.appearance);
                  }
                }}
              >
                <span style={{ background: option.appearance }} />
                {option.label}
                {selectedName === option.name && <Check size={12} />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
