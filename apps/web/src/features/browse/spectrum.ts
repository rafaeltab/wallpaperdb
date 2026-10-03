export type Hsv = { h: number; s: number; v: number };
export function hexToHsv(hex: string): Hsv {
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
export function hsvToHex({ h, s, v }: Hsv): string {
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

export function spectrumPoint(hue: number, x: number, y: number): Hsv {
  return {
    h: hue,
    s: Math.max(0, Math.min(100, x * 100)),
    v: 100 - Math.max(0, Math.min(100, y * 100)),
  };
}
export function colorPickerTab(key: string, current: string): string | undefined {
  const tabs = ['Spectrum', 'Swatches', 'Features'];
  const index = tabs.indexOf(current);
  if (key === 'ArrowRight') return tabs[(index + 1) % 3];
  if (key === 'ArrowLeft') return tabs[(index + 2) % 3];
  if (key === 'Home') return tabs[0];
  if (key === 'End') return tabs[2];
  return undefined;
}
