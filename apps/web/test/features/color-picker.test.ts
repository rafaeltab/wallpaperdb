import { expect, it } from 'vitest';
import { hexToHsv, hsvToHex, spectrumPoint, colorPickerTab } from '@/features/browse';
it('round-trips colors including grayscale and hue sectors', () => {
  for(const color of ['#000000','#FFFFFF','#808080','#FF0000','#00FF00','#0000FF','#FFFF00','#00FFFF','#FF00FF','#5D80D6'])
    expect(hsvToHex(hexToHsv(color))).toBe(color);
  expect(hexToHsv('#000000')).toEqual({h:0,s:0,v:0});
});
it('bounds spectrum coordinates while preserving hue', () => {
  expect(spectrumPoint(120,0.5,0.25)).toEqual({h:120,s:50,v:75});
  expect(spectrumPoint(120,-0.5,2)).toEqual({h:120,s:0,v:0});
});
it('maps picker tab keys with wraparound and ignores unrelated keys', () => {
  expect(colorPickerTab('ArrowLeft','Spectrum')).toBe('Features');
  expect(colorPickerTab('ArrowRight','Features')).toBe('Spectrum');
  expect(colorPickerTab('Home','Features')).toBe('Spectrum');
  expect(colorPickerTab('Enter','Features')).toBeUndefined();
});
