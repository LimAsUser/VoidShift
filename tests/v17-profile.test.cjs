const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
  const store=new Map();let pending=Promise.resolve();
  const s={Date,console,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
    navigator:{locks:{request:(name,fn)=>{const result=pending.then(fn);pending=result.catch(()=>{});return result;}}}};
  vm.runInNewContext(fs.readFileSync('js/rewards.js','utf8'),s);
  return {R:vm.runInNewContext('SaveRewards',s),store};
}
test('started missions settle once by ID without inventing historical records',async()=>{
  const {R}=setup();assert.equal(typeof R.startProfileMission,'function');
  await R.startProfileMission('m','hard');await Promise.all([R.settleProfileMission('m','success'),R.settleProfileMission('m','success')]);
  const rows=R.profileCounts();assert.equal(rows.hard.success,1);assert.equal(rows.easy.success,0);
  await R.settleProfileMission('m','quit');assert.equal(R.profileCounts().hard.failure,0);
});
test('pre-start aborts and temporary disconnects do not count, settled departures do',async()=>{
  const {R}=setup();assert.equal(typeof R.startProfileMission,'function');
  await R.settleProfileMission('not-started','failure');assert.equal(R.profileCounts().medium.failure,0);
  for(const [i,outcome] of ['failure','quit','kicked','timeout'].entries()){
    await R.startProfileMission(`m${i}`,'medium');await R.settleProfileMission(`m${i}`,outcome);
  }
  await R.startProfileMission('rejoining','easy');assert.equal(R.profileCounts().easy.failure,0);
  assert.equal(R.profileCounts().medium.failure,4);
});
test('stale ordinary saves cannot erase profile results and receipt retry does not count twice',async()=>{
  const {R,store}=setup();assert.equal(typeof R.startProfileMission,'function');
  await R.startProfileMission('receipt-m','easy');await R.settleProfileMission('receipt-m','success');
  store.set('voidshift_save',JSON.stringify({money:100}));
  const receipt={id:'r',missionId:'receipt-m',outcome:'success',amount:10,baseReward:10,difficultyMultiplier:1,resultMultiplier:1,expiresAt:Date.now()+10000};
  await R.applyReceipt(receipt);await R.applyReceipt(receipt);
  assert.equal(R.profileCounts().easy.success,1);assert.equal(R.read().money,110);
});
