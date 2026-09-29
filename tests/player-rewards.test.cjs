const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
function setup(data={money:100}){
  const values=new Map([['voidshift_save',JSON.stringify(data)]]);let chain=Promise.resolve();
  const context=vm.createContext({Date,Map,Set,JSON,Number,Promise,localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},navigator:{locks:{request:(name,fn)=>{const next=chain.then(fn);chain=next.catch(()=>{});return next;}}}});
  const file=path.join(__dirname,'../js/rewards.js');if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),context);
  return {api:vm.runInContext('typeof SaveRewards === "undefined" ? null : SaveRewards',context),ledger:vm.runInContext('typeof DefeatLedger === "undefined" ? null : DefeatLedger',context),data:()=>JSON.parse(values.get('voidshift_save')),overwrite:data=>values.set('voidshift_save',JSON.stringify(data))};
}
test('daily claim is serialized across tabs, persists money/date together and resets at local midnight',async()=>{
  const f=setup();assert.ok(f.api,'local daily reward transaction exists');
  const now=new Date(2026,8,29,23,59,59);
  const results=await Promise.all([f.api.claimDaily(now),f.api.claimDaily(now)]);
  assert.equal(results.filter(r=>r.claimed).length,1);assert.equal(f.data().money,1100);assert.equal(f.data().dailyRewardDate,'2026-09-29');
  assert.equal((await f.api.claimDaily(new Date(2026,8,30,0,0,0))).claimed,true);assert.equal(f.data().money,2100);
  assert.equal(f.api.nextRefresh(now).getDate(),30);
});
test('receipt replay and stale-tab save never erase reward claims or credit twice',async()=>{
  const f=setup();assert.ok(f.api,'local receipt application exists');
  const receipt={id:'m.host',amount:150,baseReward:100,difficultyMultiplier:3,resultMultiplier:.5,expiresAt:Date.now()+86400000};
  assert.equal((await f.api.applyReceipt(receipt)).applied,true);assert.equal((await f.api.applyReceipt(receipt)).applied,false);
  const stale={money:70,rewardCreditsTotal:0};const merged=f.api.mergeForSave(stale,f.data());
  assert.equal(stale.money,220);assert.equal(merged.rewardCreditsTotal,150);assert.ok(merged.appliedRewardReceipts['m.host']);
  f.api.mergeForSave(stale,f.data());assert.equal(stale.money,220);
});
test('defeat ledger counts life/cycle once, ignores temporary hunter death and freezes departed players',()=>{
  const f=setup();assert.ok(f.ledger,'host defeat ledger exists');const ledger=new f.ledger('task1',['host','guest']);
  assert.equal(ledger.record('hunter','h1:life1','host',{temporary:true}),false);
  assert.equal(ledger.record('hunter','h1:life1','host'),true);assert.equal(ledger.record('hunter','h1:life1','guest'),false);
  ledger.record('monster','n1:sleep1','guest');ledger.record('monster','n1:sleep1','guest');ledger.record('monster','n1:sleep2','guest');
  const row=ledger.freeze('guest','quit','medium');assert.equal(row.amount,60);assert.equal(row.counts.monster,2);
  assert.equal(ledger.record('heavy','hv1:life1','guest'),false);
  assert.equal(ledger.freeze('guest','success','hard').amount,60);
  assert.equal(ledger.freeze('host','success','hard').amount,30);
});

test('a simultaneous ordinary save cannot erase the canonical daily claim or receipt marker',async()=>{
  const f=setup(),date=new Date(2026,8,29,12);
  await f.api.claimDaily(date);
  f.overwrite({money:70,rewardCreditsTotal:0});
  assert.equal((await f.api.claimDaily(date)).claimed,false);
  assert.equal(f.api.read().money,1070);
  assert.equal(f.api.read().dailyRewardDate,'2026-09-29');
});
