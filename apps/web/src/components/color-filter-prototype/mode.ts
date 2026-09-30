// Throwaway development-only fixture mode for issue #36.
export function isColorPrototype() {
  return (
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('prototype') === 'colors'
  );
}
