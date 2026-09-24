// Shared mixed-query performance workload. Every ranking is returned by OpenSearch.
const named = (name, percent) => ({ name, ...(percent == null ? {} : { percent }) });
export const WORKLOAD = [
  { id:'red-vibe', query:{ text:'red' } },
  { id:'green-vibe', query:{ text:'green' } },
  { id:'blue-vibe', query:{ text:'blue' } },
  { id:'orange-vibe-filter10', query:{ text:'orange' }, filter:{ range:{ partition:{ lt:10 } } } },
  { id:'pink-vibe-filter1', query:{ text:'pink' }, filter:{ term:{ partition:1 } } },
  { id:'green40', query:{ mode:'proportions',targets:[named('green',40)] } },
  { id:'green70', query:{ mode:'proportions',targets:[named('green',70)] } },
  { id:'red20', query:{ mode:'proportions',targets:[named('red',20)] } },
  { id:'redgreen50', query:{ mode:'proportions',targets:[named('red',50),named('green',50)] } },
  { id:'blueorange40', query:{ mode:'proportions',targets:[named('blue',40),named('orange',40)] } },
  { id:'gray80red20', query:{ mode:'proportions',targets:[named('grayscale',80),named('red',20)] } },
  { id:'dark', query:{text:'dark'} },
  { id:'grayscale', query:{text:'grayscale'} },
  { id:'precise-warm-red', query:{swatchHex:'#ff2200'} },
  { id:'precise-muted-green', query:{swatchHex:'#4c8c72'} },
  { id:'hsl-dark-range', query:{mode:'proportions',targets:[{color:'#101010',percent:70,space:'hsl',tolerance:{h:1,s:0.2,l:0.15}}]} },
  { id:'dark-bright-spots', query:{text:'Mostly dark, with small bright areas'} },
  { id:'five-color-portions', query:{mode:'proportions',targets:['red','orange','yellow','green','blue'].map(name=>named(name,20))} },
  ...['#101010','#808080','#dd6600','#8030b0','#20b8d0'].map(color=>({id:`precise-${color.slice(1)}`,query:{swatchHex:color}})),
];
