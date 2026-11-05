/** Minimal compatibility for the server-rendered operations page's asynchronous snapshots. */
export const observationPresentation = String.raw`
const observationNotice=document.querySelector('#observation-notice');
let observationStopped=false;
let observationVersion=0;
document.addEventListener('submit',()=>{observationVersion++;},true);
document.addEventListener('click',event=>{if(event.target instanceof Element && event.target.closest('[data-action]'))observationVersion++;},true);
let observationTimer;
let observationRequest;
async function refreshObservation(){
  try{
    if(pending)return;
    const version=observationVersion;
    observationRequest=new AbortController();
    const response=await fetch('/',{signal:observationRequest.signal,cache:'no-store'});
    if(!response.ok)throw new Error('Observation unavailable');
    const next=new DOMParser().parseFromString(await response.text(),'text/html');
    if(observationStopped || pending || version!==observationVersion)return;
    let focusedWork=false;
    for(const id of ['work-observation','schedule-summary']){
      const current=document.getElementById(id);
      const replacement=next.getElementById(id);
      if(current && replacement && current.innerHTML!==replacement.innerHTML){
        if(current.contains(document.activeElement) && document.activeElement?.matches('a,button')){focusedWork=true;continue;}
        current.innerHTML=replacement.innerHTML;
      }
    }
    // Preserve the deliberate-selection draft until an admission actually exists.
    if(!next.querySelector('form[data-start]'))document.querySelector('#start-observation')?.replaceChildren();
    observationNotice.textContent=focusedWork?'Automatic updates pause while a work control has keyboard focus.':'Observations refresh automatically.';
  }catch{
    if(!observationStopped)observationNotice.textContent='Observation unavailable. Last displayed facts retained. Refresh observation to retry.';
  }finally{
    observationRequest=undefined;
    if(!observationStopped)observationTimer=setTimeout(refreshObservation,1000);
  }
}
observationTimer=setTimeout(refreshObservation,1000);
window.addEventListener('pagehide',()=>{observationStopped=true;clearTimeout(observationTimer);observationRequest?.abort();});
`;
