const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){const store=new Map();let chain=Promise.resolve();const s={Date,console,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},navigator:{locks:{request:(_n,fn)=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;}}}};vm.runInNewContext(fs.readFileSync('js/rewards.js','utf8'),s);return{R:vm.runInNewContext('SaveRewards',s),store};}
const qualify={scale:'medium',solo:true,standard:true,version:18};
test('only frozen standard solo medium-medium success unlocks advanced choices',async()=>{
 for(const [name,difficulty,context,outcome,unlocked]of [
  ['valid','medium',qualify,'success',true],['coop','medium',{...qualify,solo:false},'success',false],
  ['custom','medium',{...qualify,standard:false},'success',false],['small','medium',{...qualify,scale:'small'},'success',false],
  ['easy','easy',qualify,'success',false],['failed','medium',qualify,'failure',false],['legacy','medium',{},'success',false]]){
  const {R}=setup();await R.startProfileMission(name,difficulty,context);await R.settleProfileMission(name,outcome);
  assert.equal(!!R.read().advancedUnlocked,unlocked,name);
 }
});
test('actual defeat totals do not scale with difficulty or failure rewards and freeze once',async()=>{
 const {R}=setup();await R.startProfileMission('m','hard',{scale:'large',solo:false,standard:true,version:18});
 await R.settleProfileMission('m','failure',{hunter:10,monster:3,heavy:2});
 assert.equal(typeof R.defeatTotals,'function');assert.deepEqual(JSON.parse(JSON.stringify(R.defeatTotals())),{hunter:10,monster:3,heavy:2});
 await R.settleProfileMission('m','success',{hunter:99,monster:99,heavy:99});assert.equal(R.defeatTotals().hunter,10);
});
test('pending departed result can later acquire receipt counts without duplicate credits or defeats',async()=>{
 const {R,store}=setup();await R.startProfileMission('m','medium',{});await R.settleProfileMission('m','timeout');
 const receipt={id:'m.p',missionId:'m',outcome:'timeout',counts:{hunter:2,monster:1,heavy:0},baseReward:50,difficultyMultiplier:2,resultMultiplier:.5,amount:50,expiresAt:Date.now()+10000};
 await R.applyReceipt(receipt);await R.applyReceipt(receipt);assert.equal(typeof R.defeatTotals,'function');assert.equal(R.defeatTotals().hunter,2);assert.equal(R.read().money,50);
 store.set('voidshift_save',JSON.stringify({money:0}));assert.equal(R.defeatTotals().monster,1);assert.equal(R.read().money,50);
});
test('earned unlock survives stale ordinary save and cannot come from an unstarted receipt',async()=>{
 const {R,store}=setup();await R.startProfileMission('solo','medium',qualify);await R.settleProfileMission('solo','success');
 store.set('voidshift_save',JSON.stringify({money:100}));assert.equal(R.read().advancedUnlocked,true);
 const second=setup();await second.R.settleProfileMission('missing','success');assert.equal(!!second.R.read().advancedUnlocked,false);
});
test('qualification is frozen when start is requested, even while waiting for the save lock',async()=>{
 const {R}=setup(),context={...qualify};const started=R.startProfileMission('snapshot','medium',context);
 context.scale='small';context.solo=false;context.standard=false;await started;await R.settleProfileMission('snapshot','success');
 assert.equal(R.read().advancedUnlocked,true);
});
