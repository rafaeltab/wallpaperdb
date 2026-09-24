(async () => {
  const checks = [], queries = [
    { mode: 'vibe', targets: [{color:'#4c8c72'}] },
    { mode: 'proportions', targets: [{name:'green',color:'#209040',percent:40}] },
    { mode: 'proportions', targets: [{name:'green',color:'#209040',percent:50},{name:'red',color:'#ff0000',percent:50}] },
  ];
  for (const methodId of ['overlap-quality-dense','overlap-quality-hybrid']) for (const bucketCount of [16,64,256,1024]) for (const query of queries) {
    const response = await fetch('/api/search', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({methodId,parameters:{bucketCount},query,limit:100,includeFixtures:true})});
    const result = await response.json();
    if (!response.ok || result.hits.length !== 100) throw Error(JSON.stringify(result));
    if (result.hits.some(hit=>/^(composition-green-red|precision-shade|proportion-green)-/.test(hit.id))) throw Error('A controlled color example was returned');
    checks.push({methodId,bucketCount,query,hits:result.hits.length,index:result.evidence.index});
  }
  if (document.getElementById('include-fixtures')) throw Error('Fixture toggle remains visible');
  if (document.querySelectorAll('.result-card').length !== 24) throw Error('Gallery did not load');
  return {status:'passed',checksPassed:checks.length,checks,summary:document.getElementById('corpus-summary').textContent,note:'Explicit legacy includeFixtures:true cannot reintroduce controlled examples; exclusion is executed by OpenSearch.'};
})()
