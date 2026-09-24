(() => {
 const key='wallpaperdb:color-review:color-review-batch-001:v1';
 const value=JSON.parse(localStorage.getItem(key));
 value.answers['composition-green-red-real-002'].ranking=[['INVALID']];
 localStorage.setItem(key,JSON.stringify(value));
 return 'Seeded invalid first answer; three later answers retained for recovery check';
})()
