(() => {
 const key='wallpaperdb:color-review:color-review-batch-001:v1';
 if (!document.querySelector('#export-recovery')) throw new Error('No original-draft recovery export');
 const backup=Object.keys(localStorage).find(k=>k.startsWith(key+':recovery:'));
 if (!backup || !localStorage.getItem(backup).includes('INVALID')) throw new Error('Original draft not preserved');
 if (!document.querySelector('#progress-count').textContent.includes('1 notes only')) throw new Error('Later valid answer lost');
 const pick=label=>document.querySelector(`figure[data-label="${label}"] .pick-image`).click();
 pick('C'); let tie=document.querySelector('#tie-next'); tie.checked=true; tie.dispatchEvent(new Event('change',{bubbles:true})); pick('B');
 if(document.querySelector('#tie-next').checked) throw new Error('Next-pick tie toggle did not reset');
 pick('D');
 const saved=JSON.parse(localStorage.getItem(key));
 if(Object.keys(saved.answers).length!==4 || JSON.stringify(saved.answers['composition-green-red-real-002'].ranking)!==JSON.stringify([['C','B'],['D']])) throw new Error('Recovered later answers or tie order lost');
 return {rawOriginalBackedUp:true,laterAnswersRecovered:true,tieToggleResets:true};
})()
