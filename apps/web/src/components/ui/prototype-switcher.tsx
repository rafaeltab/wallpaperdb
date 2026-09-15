import { ArrowLeft, ArrowRight, RotateCcw, Sparkles } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { PrototypeIconButton } from '@/components/ui/prototype-icon-button';

type PrototypeVariant = 'A' | 'B' | 'C' | 'D';

const names: Record<PrototypeVariant, string> = {
  A: 'Profile card',
  B: 'Profile preview',
  C: 'Editable details',
  D: 'Inline profile',
};

const previous: Record<PrototypeVariant, PrototypeVariant> = { A: 'D', B: 'A', C: 'B', D: 'C' };
const next: Record<PrototypeVariant, PrototypeVariant> = { A: 'B', B: 'C', C: 'D', D: 'A' };

// Throwaway controls for comparing local UI variations; remove after choosing a design.
export function PrototypeSwitcher({
  variant,
  onChange,
  onReset,
  onExample,
  state,
  modalOpen,
  extraControls,
}: {
  variant: PrototypeVariant;
  onChange: (variant: PrototypeVariant) => void;
  onReset: () => void;
  onExample: () => void;
  state: unknown;
  modalOpen: boolean;
  extraControls?: ReactNode;
}) {
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        modalOpen ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
      ) {
        return;
      }

      const target = document.activeElement;
      if (
        target instanceof HTMLElement &&
        (target.closest('input, textarea, select') || target.isContentEditable)
      ) {
        return;
      }

      const openDialog = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="dialog"], [role="alertdialog"], dialog[open]'
        )
      ).some((dialog) => dialog.dataset.state !== 'closed' && dialog.getClientRects().length > 0);
      if (openDialog) return;

      event.preventDefault();
      onChange(event.key === 'ArrowLeft' ? previous[variant] : next[variant]);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modalOpen, onChange, variant]);

  if (!import.meta.env.DEV) return null;

  return (
    <aside
      aria-label="Prototype controls"
      className="fixed bottom-3 left-1/2 z-40 w-[calc(100%_-_1.5rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-amber-400/40 bg-background/95 p-2 shadow-xl shadow-black/25 backdrop-blur-md"
    >
      <p className="mb-1 text-center text-[11px] font-medium tracking-wide text-amber-700 dark:text-amber-300">
        Prototype · Edits stay here
      </p>
      <div className="flex items-center justify-between gap-2">
        <PrototypeIconButton label="Previous prototype" onClick={() => onChange(previous[variant])}>
          <ArrowLeft aria-hidden="true" />
        </PrototypeIconButton>
        <p
          className="min-w-0 text-center text-sm font-medium"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="mr-2 text-amber-700 dark:text-amber-300">{variant}</span>
          {names[variant]}
        </p>
        <PrototypeIconButton label="Next prototype" onClick={() => onChange(next[variant])}>
          <ArrowRight aria-hidden="true" />
        </PrototypeIconButton>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1 border-t border-border/60 pt-1">
        <Button type="button" variant="ghost" size="xs" onClick={onReset}>
          <RotateCcw aria-hidden="true" />
          Reset
        </Button>
        <Button type="button" variant="ghost" size="xs" onClick={onExample}>
          <Sparkles aria-hidden="true" />
          Example content
        </Button>
        {extraControls}
      </div>
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer rounded px-2 py-1 text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          Prototype state
        </summary>
        <pre className="mt-1 max-h-[min(40vh,20rem)] overflow-y-auto rounded-lg bg-muted p-3 text-[11px] whitespace-pre-wrap break-all">
          {JSON.stringify({ variant, state }, null, 2)}
        </pre>
      </details>
    </aside>
  );
}
