import { Plus, RotateCcw, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  type ColorPreference,
  colorPreferenceKey,
  isDistributionPreference,
  MATCH_LABELS,
  MATCH_PREFERENCES,
} from '@/lib/color-preferences';
import { ColorComposition } from './color-composition';
import { ColorPicker } from './color-picker';
import './color-filter.css';

export function ColorFilter({
  value,
  onChange,
}: {
  value: readonly ColorPreference[];
  onChange: (value: ColorPreference[]) => void;
}) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const add = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const serialized = JSON.stringify(value);
  useEffect(() => {
    void serialized;
    setEditing(null);
  }, [serialized]);
  const initial = typeof editing === 'number' ? value[editing] : undefined;
  return (
    <Dialog.Root
      open={editing !== null}
      onOpenChange={(open) => {
        if (!open) setEditing(null);
      }}
    >
      <div className="color-filter">
        <div className="color-filter-heading">
          <span className="text-sm font-medium">Color</span>
          <Dialog.Trigger asChild>
            <Button
              ref={add}
              type="button"
              variant="outline"
              size="sm"
              disabled={value.length >= 10}
              title={value.length >= 10 ? 'Up to ten color preferences' : undefined}
              onClick={(e) => {
                returnFocus.current = e.currentTarget;
                setEditing('new');
              }}
            >
              <Plus size={15} />
              Add color or feature
            </Button>
          </Dialog.Trigger>
        </div>
        <ColorComposition
          value={value}
          onChange={onChange}
          onEmpty={() => add.current?.focus()}
          onEdit={(index, button) => {
            returnFocus.current = button;
            setEditing(index);
          }}
        />
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="color-editor fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 border bg-background shadow-2xl outline-none"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (returnFocus.current?.isConnected ? returnFocus.current : add.current)?.focus();
          }}
        >
          {editing !== null && (
            <ColorEditor
              key={editing}
              initial={initial ?? { color: '#5D80D6', quality: 'FAVORITE' }}
              adding={editing === 'new'}
              maximum={
                100 -
                value.reduce(
                  (sum, target, index) => sum + (index === editing ? 0 : (target.percent ?? 0)),
                  0
                )
              }
              duplicate={(draft) =>
                value.some(
                  (target, index) =>
                    index !== editing && colorPreferenceKey(target) === colorPreferenceKey(draft)
                )
              }
              onSave={(draft) => {
                onChange(
                  editing === 'new'
                    ? [...value, draft]
                    : value.map((target, index) => (index === editing ? draft : target))
                );
                setEditing(null);
              }}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function ColorEditor({
  initial,
  adding,
  maximum,
  duplicate,
  onSave,
}: {
  initial: ColorPreference;
  adding: boolean;
  maximum: number;
  duplicate: (value: ColorPreference) => boolean;
  onSave: (value: ColorPreference) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [valid, setValid] = useState(true);
  const repeated = duplicate(draft);
  const distribution = isDistributionPreference(draft);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  function percent(value: number | undefined) {
    setDraft((old) => {
      const { percent: previous, ...rest } = old;
      void previous;
      return value === undefined
        ? rest
        : { ...rest, percent: Math.max(0, Math.min(maximum, Math.round(value / 10) * 10)) };
    });
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !repeated) onSave(draft);
      }}
    >
      <div className="color-editor-heading">
        <Dialog.Title ref={heading} tabIndex={-1} className="outline-none">
          {adding ? 'Add color or feature' : 'Edit color or feature'}
        </Dialog.Title>
        <Dialog.Close asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close editor">
            <X size={17} />
          </Button>
        </Dialog.Close>
      </div>
      <Dialog.Description className="sr-only">
        Choose one color or visual feature, an optional percentage, and your match preference.
      </Dialog.Description>
      <div className="color-editor-body">
        <ColorPicker
          initial={initial}
          onValidChange={setValid}
          onChoose={(choice) =>
            setDraft((old) => ({
              ...choice,
              quality: old.quality,
              ...(old.percent === undefined ? {} : { percent: old.percent }),
            }))
          }
        />
        <div className="color-editor-controls">
          <div className="color-amount-control">
            <button
              type="button"
              aria-label={draft.percent === undefined ? 'Add percentage' : 'Clear percentage'}
              title={
                distribution
                  ? 'Distribution strength across the image'
                  : 'Requested proportion of the image'
              }
              onClick={() =>
                percent(draft.percent === undefined ? Math.min(40, maximum) : undefined)
              }
            >
              {draft.percent === undefined
                ? distribution
                  ? 'Any strength'
                  : 'Any amount'
                : `About ${draft.percent}%`}
            </button>
            <div className="color-amount-slider">
              {draft.percent !== undefined && (
                <>
                  <input
                    type="range"
                    aria-label={distribution ? 'Distribution strength' : 'Percentage'}
                    min="0"
                    max={maximum}
                    step="10"
                    value={draft.percent}
                    onChange={(e) => percent(Number(e.target.value))}
                  />
                  <button
                    type="button"
                    aria-label="Clear percentage"
                    onClick={() => percent(undefined)}
                  >
                    <RotateCcw size={13} />
                  </button>
                </>
              )}
            </div>
          </div>
          <label className="color-match-control">
            <span>
              Match <small>{MATCH_LABELS[draft.quality]}</small>
            </span>
            <input
              type="range"
              aria-label="Match preference"
              min="0"
              max="2"
              step="1"
              value={MATCH_PREFERENCES.indexOf(draft.quality)}
              aria-valuetext={MATCH_LABELS[draft.quality]}
              onChange={(e) => {
                const quality = MATCH_PREFERENCES[Number(e.target.value)];
                if (quality) setDraft((old) => ({ ...old, quality }));
              }}
            />
          </label>
        </div>
        <div className="color-editor-feedback" aria-live="polite">
          {repeated && (
            <span className="color-error">Already selected. Choose another color or feature.</span>
          )}
          {distribution && (
            <span className="color-distribution-hint">
              Percentage describes distribution strength.
            </span>
          )}
        </div>
      </div>
      <div className="color-editor-footer">
        <Dialog.Close asChild>
          <Button type="button" variant="ghost" size="sm">
            Cancel
          </Button>
        </Dialog.Close>
        <Button type="submit" size="sm" disabled={!valid || repeated}>
          Save
        </Button>
      </div>
    </form>
  );
}
