import { expect, it } from 'vitest';
import { compositionLayout, moveColorBoundary, setColorPercentage, colorEditLimits, saveColorPreference, type ColorPreference } from '@/features/browse';
const colors: ColorPreference[] = [
  { color: '#FF0000', quality: 'FAVORITE', percent: 30 },
  { name: 'BLUE', quality: 'STRICT', percent: 40 },
  { name: 'GREEN', quality: 'RELAXED' },
];
it('allocates positive visible widths totaling 100 including free space and zero amounts', () => {
  for (const value of [colors, [], [{ ...colors[0], percent: 0 }], colors.slice(0, 2)]) {
    const result = compositionLayout(value);
    expect(result.weights.every(v => Number.isFinite(v) && v > 0)).toBe(true);
    expect(result.weights.reduce((a,b) => a+b, result.free)).toBeCloseTo(100);
  }
});
it('moves boundaries in ten-percent steps, conserving the pair and limiting total allocation', () => {
  expect(moveColorBoundary(colors, 0, 45).map(v=>v.percent)).toEqual([50,20,undefined]);
  expect(moveColorBoundary(colors, 0, 200).map(v=>v.percent)).toEqual([100,0,undefined]);
  expect(moveColorBoundary(colors, 2, 30)).toEqual(colors);
  expect(colors[0].percent).toBe(30);
  for (let requested=-100;requested<=200;requested+=7) {
    const value=moveColorBoundary(colors,0,requested);
    expect(value.reduce((sum,v)=>sum+(v.percent??0),0)).toBeLessThanOrEqual(100);
    expect(value.every(v=>v.percent===undefined||(v.percent>=0&&v.percent%10===0))).toBe(true);
  }
});
it('caps and clears draft percentages without losing the selected target', () => {
  expect(setColorPercentage(colors[0], 99, 40).percent).toBe(40);
  expect(setColorPercentage(colors[0], -12, 40).percent).toBe(0);
  expect(setColorPercentage(colors[0], undefined, 40)).toEqual({color:'#FF0000',quality:'FAVORITE'});
});
it('rejects duplicate, overallocated and over-limit preferences while allowing replacement', () => {
  expect(colorEditLimits(colors,0,colors[0])).toEqual({maximum:60,duplicate:false});
  expect(saveColorPreference(colors,'new',colors[0])).toBeUndefined();
  expect(saveColorPreference(colors,'new',{color:'#FFFFFF',quality:'FAVORITE',percent:40})).toBeUndefined();
  expect(saveColorPreference(colors,0,{...colors[0],percent:50})?.[0].percent).toBe(50);
  const ten=Array.from({length:10},(_,i)=>({color:`#00000${i}`,quality:'FAVORITE' as const}));
  expect(saveColorPreference(ten,'new',{color:'#FFFFFF',quality:'FAVORITE'})).toBeUndefined();
});
