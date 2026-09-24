(()=>{const section=Array.from(document.querySelectorAll('section')).find(x=>x.querySelector('h2')?.innerText==='Large-window ranking diagnostic');
section.scrollIntoView();
const table=section.querySelector('.table-scroll');
table.scrollLeft=table.scrollWidth;
return JSON.stringify({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,summary:document.querySelector('summary').innerText,table:{clientWidth:table.clientWidth,scrollWidth:table.scrollWidth,scrollLeft:table.scrollLeft},openGalleryImages:Array.from(document.querySelectorAll('details[open] img')).map(x=>({complete:x.complete,width:x.naturalWidth})),visibleLabels:section.innerText},null,2)})()