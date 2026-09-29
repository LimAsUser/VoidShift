const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
function fixture(){const storage=new Map([['voidshift_save',JSON.stringify({money:100})]]),requests=[];let chain=Promise.resolve(),fail=false,saveFailures=0;
 const receipt={id:'mission.host',missionId:'mission',playerId:'host',amount:30,baseReward:10,difficultyMultiplier:3,resultMultiplier:1,expiresAt:Date.now()+86400000};
 const context=vm.createContext({window:{},Date,Map,Set,JSON,Number,Promise,crypto:globalThis.crypto,setTimeout,clearTimeout,AbortController,
 localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(key==='voidshift_reward_ledger'&&saveFailures-->0)throw Error('temporarily unavailable');storage.set(key,value);}},navigator:{locks:{request:(key,fn)=>{const r=chain.then(fn);chain=r.catch(()=>{});return r;}}},
 fetch:async(url,options)=>{requests.push({url,options});if(fail)throw Error('offline');return{ok:true,status:200,json:async()=>url.includes('/receipts/')?{status:'complete',receipt}:{ok:true}};}});
 for(const file of ['rewards','reward-client']){const p=path.join(__dirname,'../js',file+'.js');if(fs.existsSync(p))vm.runInContext(fs.readFileSync(p,'utf8'),context);}
 const Client=vm.runInContext('typeof MissionRewardsClient==="undefined"?null:MissionRewardsClient',context);
 return{Client,storage,requests,offline:value=>fail=value,failCreditSave:()=>saveFailures=1,receipt};}
test('failed reports stay durable, reopening retries and applies each receipt only once',async()=>{
 const f=fixture();assert.ok(f.Client,'durable receipt client exists');const client=new f.Client();
 await client.register({missionId:'mission',roomCode:'ABC234',difficulty:'hard',playerIds:['host']},'room-token');
 f.offline(true);await client.queueReport('mission',[{playerId:'host',outcome:'success',counts:{hunter:1,monster:0,heavy:0}}]);
 await client.flush();assert.ok(JSON.parse(f.storage.get('voidshift_reward_pending')).reports['mission.host']);
 f.offline(false);const reopened=new f.Client();await reopened.flush();
 assert.equal(JSON.parse(f.storage.get('voidshift_save')).money,130);
 assert.equal(Object.keys(JSON.parse(f.storage.get('voidshift_reward_pending')).reports).length,0);
 await reopened.flush();assert.equal(JSON.parse(f.storage.get('voidshift_save')).money,130);
});
test('claim access is personal and only persisted reports are sent',async()=>{
 const f=fixture();assert.ok(f.Client);const client=new f.Client();
 const registered=await client.register({missionId:'mission',roomCode:'ABC234',difficulty:'hard',playerIds:['host','p2']},'hosttoken');
 assert.notEqual(registered.access.host.claimToken,registered.access.p2.claimToken);
 assert.ok(!('reportToken' in registered.access.p2));
 const reportRequests=f.requests.filter(r=>r.url.endsWith('/reports'));assert.equal(reportRequests.length,0);
 const other=new f.Client();await other.rememberAccess(registered.access.p2);
 assert.ok(JSON.parse(f.storage.get('voidshift_reward_pending')).claims['mission.p2']);
});

test('solo receipts survive a failed credit write and apply on reopening without network',async()=>{
 const f=fixture(),client=new f.Client();assert.equal(typeof client.queueLocalReceipt,'function');
 await client.queueLocalReceipt(f.receipt);f.failCreditSave();await client.flush();
 assert.ok(JSON.parse(f.storage.get('voidshift_reward_pending')).localReceipts[f.receipt.id]);
 const reopened=new f.Client();await reopened.flush();await reopened.flush();
 assert.equal(JSON.parse(f.storage.get('voidshift_save')).money,130);assert.equal(f.requests.length,0);
 assert.equal(Object.keys(JSON.parse(f.storage.get('voidshift_reward_pending')).localReceipts).length,0);
});
