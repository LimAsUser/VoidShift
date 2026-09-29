const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const ctx=vm.createContext({});for(const file of ['config','inventory'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),ctx);
const {BackpackManager,ContainerTransactions}=vm.runInContext('({BackpackManager,ContainerTransactions:typeof ContainerTransactions === "undefined"?null:ContainerTransactions})',ctx);
function fixture(){assert.ok(ContainerTransactions,'host container transaction processor exists');const box={id:'crate-1',x:100,y:100,fixed:true,revision:0,items:[{id:'loot-a',shape:'1x2',gx:0,gy:0,rot:0,value:10}]};return {box,store:new ContainerTransactions([box]),pack:new BackpackManager(2,2),actor:{x:100,y:100,downed:false}};}
test('two players taking the same item get exactly one item and repeat returns the first result',()=>{
  const f=fixture();const req={requestId:1,containerId:'crate-1',itemId:'loot-a',action:'take'};
  const accepted=f.store.transact('p1',req,f.actor,f.pack);assert.equal(accepted.accepted,true);
  assert.equal(f.store.transact('p1',req,f.actor,f.pack).revision,accepted.revision);
  const other=new BackpackManager(2,2);assert.equal(f.store.transact('p2',req,f.actor,other).accepted,false);
  assert.equal(f.pack.items.length,1);assert.equal(other.items.length,0);assert.equal(f.box.items.length,0);
});
test('full, distant and stale requests are rejected without loss, and deposits preserve item identity',()=>{
  const f=fixture();f.pack=new BackpackManager(1,1);const request={requestId:1,containerId:'crate-1',itemId:'loot-a',action:'take'};
  assert.equal(f.store.transact('p1',request,f.actor,f.pack).reason,'full');assert.equal(f.box.items.length,1);
  f.pack=new BackpackManager(2,2);f.actor.x=1000;assert.equal(f.store.transact('p1',{...request,requestId:2},f.actor,f.pack).reason,'out-of-range');
  f.actor.x=100;assert.equal(f.store.transact('p1',{...request,requestId:3},f.actor,f.pack).accepted,true);
  assert.equal(f.store.transact('p1',{...request,requestId:4,action:'deposit'},f.actor,f.pack).accepted,true);
  assert.equal(f.box.items[0].id,'loot-a');assert.equal(f.pack.items.length,0);
  assert.equal(f.store.transact('p1',{...request,requestId:3},f.actor,f.pack).accepted,true);assert.equal(f.pack.items.length,0);
});
test('expired dedupe entries cannot execute again and world containers accept legal rotated placement only',()=>{
  const f=fixture();const request={requestId:1,containerId:'crate-1',itemId:'loot-a',action:'move',gx:4,gy:5,rot:1};
  assert.equal(f.store.transact('p',request,f.actor,f.pack).accepted,true);assert.equal(f.box.items[0].rot,1);
  for(let i=2;i<300;i++)f.store.transact('p',{...request,requestId:i,gx:6},f.actor,f.pack);
  assert.equal(f.store.transact('p',{...request,gx:0},f.actor,f.pack).reason,'stale-request');
  assert.equal(f.box.items[0].gx,4);assert.ok(f.store.requests.get('p').results.size<=128);
});

test('independent starter bottles from two players share a crate without identity collisions and rejoin keeps IDs',()=>{
 ctx.window={addEventListener(){}};vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/game.js'),'utf8'),ctx);
 const Game=vm.runInContext('Game',ctx),g=Object.create(Game.prototype);g.state={missionFxId:'mission-1',coop:{}};
 const item={id:'starter-oxygen-1',shape:'1x2',effect:'oxygen-50'};
 const own=g._namespacePersistentBackpackItems([{...item}],'host','mission-1');
 const friend=g._namespacePersistentBackpackItems([{...item}],'p2','mission-1');assert.notEqual(own[0].id,friend[0].id);
 assert.equal(g._namespacePersistentBackpackItems(own,'host','mission-1')[0].id,own[0].id);
 const a=new BackpackManager(8,5),b=new BackpackManager(8,5);a.place(own[0]);b.place(friend[0]);
 const crate={id:'shared',x:0,y:0,fixed:true,items:[]},store=new ContainerTransactions([crate]);
 for(const [id,pack] of [['host',a],['p2',b]])assert.equal(store.transact(id,{requestId:1,containerId:'shared',itemId:pack.items[0].id,action:'deposit'},{x:0,y:0},pack).accepted,true);
 assert.equal(crate.items.length,2);
});
