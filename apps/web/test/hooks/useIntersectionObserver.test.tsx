import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { clearIntersectionObservers, triggerIntersection } from '../setup';
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver';

// Test component that uses the hook and exposes its state
function TestComponent({
  enabled = true,
  threshold,
  rootMargin,
  onStateChange,
}: {
  enabled?: boolean;
  threshold?: number;
  rootMargin?: string;
  onStateChange?: (isIntersecting: boolean) => void;
}) {
  const { ref, isIntersecting } = useIntersectionObserver({
    enabled,
    threshold,
    rootMargin,
  });

  // Report state changes to test
  if (onStateChange) {
    onStateChange(isIntersecting);
  }

  return (
    <div>
      <div ref={ref} data-testid="observed-element">
        Observed Element
      </div>
      <span data-testid="is-intersecting">{isIntersecting ? 'true' : 'false'}</span>
    </div>
  );
}

// Wrapper component to control enabled prop from test
function ControlledTestComponent({
  initialEnabled = true,
  onStateChange,
}: {
  initialEnabled?: boolean;
  onStateChange?: (isIntersecting: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);

  return (
    <div>
      <TestComponent enabled={enabled} onStateChange={onStateChange} />
      <button data-testid="toggle-enabled" onClick={() => setEnabled((e) => !e)}>
        Toggle
      </button>
    </div>
  );
}

describe('useIntersectionObserver', () => {
  beforeEach(() => {
    clearIntersectionObservers();
  });

  it('returns isIntersecting: false initially', () => {
    render(<TestComponent />);

    expect(screen.getByTestId('is-intersecting').textContent).toBe('false');
  });

  it('updates isIntersecting when observer fires', () => {
    render(<TestComponent />);

    expect(screen.getByTestId('is-intersecting').textContent).toBe('false');

    // Trigger intersection
    act(() => {
      triggerIntersection(true);
    });

    expect(screen.getByTestId('is-intersecting').textContent).toBe('true');

    // Trigger leaving viewport
    act(() => {
      triggerIntersection(false);
    });

    expect(screen.getByTestId('is-intersecting').textContent).toBe('false');
  });

  it('does NOT create observer when enabled: false', () => {
    render(<TestComponent enabled={false} />);

    // Trigger intersection - should not change state since observer not created
    act(() => {
      triggerIntersection(true);
    });

    expect(screen.getByTestId('is-intersecting').textContent).toBe('false');
  });

  describe('bug regression: infinite loading loop', () => {
    it('resets isIntersecting to false when enabled changes to false', () => {
      render(<ControlledTestComponent />);

      // Initial state
      expect(screen.getByTestId('is-intersecting').textContent).toBe('false');

      // Trigger intersection - element is in viewport
      act(() => {
        triggerIntersection(true);
      });

      expect(screen.getByTestId('is-intersecting').textContent).toBe('true');

      // Disable (like when loading starts)
      act(() => {
        screen.getByTestId('toggle-enabled').click();
      });

      // isIntersecting should be reset to false
      expect(screen.getByTestId('is-intersecting').textContent).toBe('false');
    });

    it('does NOT stay isIntersecting: true after disable/re-enable cycle without actual intersection', () => {
      render(<ControlledTestComponent />);

      // Trigger intersection - element is in viewport
      act(() => {
        triggerIntersection(true);
      });

      expect(screen.getByTestId('is-intersecting').textContent).toBe('true');

      // Disable (loading starts)
      act(() => {
        screen.getByTestId('toggle-enabled').click();
      });

      expect(screen.getByTestId('is-intersecting').textContent).toBe('false');

      // Re-enable (loading completes) - but don't trigger intersection
      act(() => {
        screen.getByTestId('toggle-enabled').click();
      });

      // Should still be false since no intersection was triggered
      expect(screen.getByTestId('is-intersecting').textContent).toBe('false');
    });

    it('skips first intersecting callback after re-enable to prevent immediate re-trigger', () => {
      render(<ControlledTestComponent />);

      // Initial intersection
      act(() => {
        triggerIntersection(true);
      });

      expect(screen.getByTestId('is-intersecting').textContent).toBe('true');

      // Disable
      act(() => {
        screen.getByTestId('toggle-enabled').click();
      });

      expect(screen.getByTestId('is-intersecting').textContent).toBe('false');

      // Re-enable
      act(() => {
        screen.getByTestId('toggle-enabled').click();
      });

      // First intersection after re-enable is skipped (prevents immediate re-trigger)
      act(() => {
        triggerIntersection(true);
      });

      // Should still be false - first intersecting callback was skipped
      expect(screen.getByTestId('is-intersecting').textContent).toBe('false');
    });

    it('correctly reports intersection after user scrolls away and back', () => {
      render(<ControlledTestComponent />);

      // Initial intersection
      act(() => {
        triggerIntersection(true);
      });

      expect(screen.getByTestId('is-intersecting').textContent).toBe('true');

      // Disable (loading starts)
      act(() => {
        screen.getByTestId('toggle-enabled').click();
      });

      expect(screen.getByTestId('is-intersecting').textContent).toBe('false');

      // Re-enable (loading completes)
      act(() => {
        screen.getByTestId('toggle-enabled').click();
      });

      // First intersection skipped
      act(() => {
        triggerIntersection(true);
      });

      expect(screen.getByTestId('is-intersecting').textContent).toBe('false');

      // User scrolls away - element leaves viewport
      act(() => {
        triggerIntersection(false);
      });

      expect(screen.getByTestId('is-intersecting').textContent).toBe('false');

      // User scrolls back - element enters viewport again
      act(() => {
        triggerIntersection(true);
      });

      // NOW it should report as intersecting (user actively scrolled back)
      expect(screen.getByTestId('is-intersecting').textContent).toBe('true');
    });
  });
});
