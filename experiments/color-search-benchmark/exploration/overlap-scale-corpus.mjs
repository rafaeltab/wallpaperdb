// Performance inputs only: mixtures of measured descriptors, not new photographs.
export const OVERLAP_SYNTHETIC_PROVENANCE = {
  version:1,
  kind:'Deterministic mixtures of two original-image overlapping-region descriptors',
  formula:'area = w*A + (1-w)*B; qualityMass = w*A*QA + (1-w)*B*QB; conditionalQuality = qualityMass/area',
  limitations:[
    'A million descriptor mixtures are not a million independent real wallpapers.',
    'Sources contain rounded basis-point coverage; synthetic mixtures retain that measurement approximation.',
    'Repeated source structure and values can make compression/cache behavior optimistic.',
    'Named global monochromatic/rainbow descriptors are interpolated performance inputs, not recomputed distribution properties.',
    'Partition filters model 1%/10% selectivity, not real subject distributions. No accuracy labels are synthesized.',
  ],
};
function hash32(value) {
  let n=value>>>0;n^=n>>>16;n=Math.imul(n,0x7feb352d);n^=n>>>15;n=Math.imul(n,0x846ca68b);n^=n>>>16;return n>>>0;
}
export function mixOverlapDocuments(a,b,weight,index,coverageFields=Object.keys(a).filter(key=>key.startsWith('cov_'))) {
  if(!Number.isFinite(weight)||weight<0||weight>1)throw Error('Mixture weight must be in [0,1]');
  const result={id:`overlap-synthetic-${String(index).padStart(9,'0')}`,reference_id:a.id,cohort:'synthetic-mixture',partition:index%100};
  for(const field of coverageFields) {
    const qualityField='quality_'+field.slice(4),aa=a[field]??0,ba=b[field]??0;
    const area=aa*weight+ba*(1-weight),mass=aa*(a[qualityField]??0)*weight+ba*(b[qualityField]??0)*(1-weight);
    result[field]=Math.round(area);
    result[qualityField]=result[field]>0?Math.fround(mass/area):0;
  }
  return result;
}
export function syntheticOverlapDocument(documents,index,{seed=99539473,coverageFields}={}) {
  if(!documents.length||!Number.isSafeInteger(index)||index<0)throw Error('Source documents and nonnegative index required');
  const a=hash32(index+seed)%documents.length;
  const b=documents.length===1?a:(a+1+hash32(index+seed+0x5bd1e995)%(documents.length-1))%documents.length;
  const weight=.05+.9*(hash32(index+seed+0x27d4eb2d)/0xffffffff);
  return mixOverlapDocuments(documents[a],documents[b],weight,index,coverageFields);
}
