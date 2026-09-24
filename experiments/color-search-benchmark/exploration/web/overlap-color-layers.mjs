// Display requests only. The saved inspection snapshot is the sole source of
// query settings; selecting a layer never changes the wallpaper search.
const cutoffs = Object.freeze([0, .25, .5, .75, .9]);
const profiles = Object.freeze(['hard', 'feather', 'core-halo', 'consensus', 'all-levels']);
const profileLabels = Object.freeze({ hard: 'Hard cutoff', feather: 'Feathered cutoff', 'core-halo': 'Full core, soft halo' });
const cutoffLabel = cutoff => `${Math.round(cutoff * 100)}%`;
const layerValue = cutoff => `cutoff-${Math.round(cutoff * 100)}`;
const metricsByMethod = Object.freeze({
  'cutoff-shade-all-levels': 'shade-aware',
  'cutoff-shade-hue-all-levels': 'shade-hue-aware',
});

function savedProfile(snapshot) {
  if (['overlap-quality-dense', 'overlap-quality-hybrid'].includes(snapshot?.method)) return null;
  const metric = metricsByMethod[snapshot?.method];
  if (metric ? snapshot?.definition?.metric !== metric : Object.values(metricsByMethod).includes(snapshot?.definition?.metric)) throw Error('Invalid saved color membership metric.');
  const profile = metric ? 'all-levels' : profiles.find(value => snapshot?.method === `cutoff-${value}`);
  if (!profile || snapshot?.definition?.profile !== profile) throw Error('Invalid saved color membership profile.');
  if (!cutoffs.includes(snapshot.parameters?.pixelCutoff)) throw Error('Invalid saved pixel cutoff.');
  if (profile === 'all-levels') {
    const exponent = snapshot.parameters.cutoffBlendExponent;
    if (!Number.isFinite(exponent) || exponent < 0 || exponent > 6) throw Error('Invalid saved cutoff weighting.');
  }
  return profile;
}

export function colorLayerOptions(snapshot) {
  const profile = savedProfile(snapshot);
  if (!profile) return [];
  const cutoff = snapshot.parameters.pixelCutoff;
  const blended = profile === 'all-levels' || profile === 'consensus';
  let currentLabel;
  if (profile === 'all-levels') {
    currentLabel = `Combined · all five cutoffs · weighting ${snapshot.parameters.cutoffBlendExponent.toFixed(1)}`;
  } else if (profile === 'consensus') {
    const first = cutoffs.indexOf(cutoff);
    const active = [...new Set([0, 1, 2].map(offset => cutoffs[Math.min(first + offset, cutoffs.length - 1)]))];
    currentLabel = `Combined · ${active.map(cutoffLabel).join(' / ')} cutoffs`;
  } else {
    currentLabel = `Current · ${profileLabels[profile]} · ${cutoffLabel(cutoff)}`;
  }
  return [
    { value: blended ? 'combined' : 'current', label: currentLabel },
    ...cutoffs.map(level => ({ value: layerValue(level), label: `${cutoffLabel(level)} cutoff layer` })),
  ];
}

export function colorLayerRequest(snapshot, regionIndex, selectedValue) {
  const options = colorLayerOptions(snapshot);
  const selected = selectedValue === undefined ? options[0]?.value ?? 'current' : selectedValue;
  if (!Number.isInteger(regionIndex) || regionIndex < 0 || regionIndex >= 1024) throw Error('Invalid color region index.');
  const bucketCount = snapshot.parameters?.bucketCount ?? 1024;
  if (![16, 64, 256, 1024].includes(bucketCount)) throw Error('Invalid saved bucket count.');
  const metric = metricsByMethod[snapshot.method];
  const args = { regionIndex, bucketCount, ...(metric ? { metric } : {}) };
  if (!options.length) {
    if (selected !== 'current') throw Error('Invalid color cutoff layer.');
    return args;
  }
  if (!options.some(option => option.value === selected)) throw Error('Invalid color cutoff layer.');
  const profile = snapshot.definition.profile;
  if (selected === 'current' || selected === 'combined') {
    return { ...args, profile, cutoff: snapshot.parameters.pixelCutoff,
      ...(profile === 'all-levels' ? { cutoffBlendExponent: snapshot.parameters.cutoffBlendExponent } : {}),
    };
  }
  return { ...args,
    profile: profile === 'all-levels' || profile === 'consensus' ? 'hard' : profile,
    cutoff: cutoffs.find(cutoff => layerValue(cutoff) === selected),
  };
}
