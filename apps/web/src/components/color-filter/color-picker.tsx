import { Check } from 'lucide-react';
import { useId, useState } from 'react';
import {
  COLOR_TARGETS,
  type ColorPreference,
  type Hsv,
  hexToHsv,
  hsvToHex,
  spectrumPoint,
  colorPickerTab,
} from '@/features/browse';

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
              const next = colorPickerTab(e.key, name);
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
                changeSpectrum(
                  spectrumPoint(
                    hsv.h,
                    (e.clientX - rect.left) / rect.width,
                    (e.clientY - rect.top) / rect.height
                  )
                );
              }}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const rect = e.currentTarget.getBoundingClientRect();
                changeSpectrum(
                  spectrumPoint(
                    hsv.h,
                    (e.clientX - rect.left) / rect.width,
                    (e.clientY - rect.top) / rect.height
                  )
                );
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
