const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const s = { console, structuredClone };
const file = path.join(__dirname, '../js/equipment.js');
if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), s);
function equipment() {
  assert.equal(vm.runInNewContext('typeof EquipmentController', s), 'function', 'mission equipment controller exists');
  const C = vm.runInNewContext('EquipmentController', s);
  const g = { state: { elapsed: 0, missionFxId: 'm', coop: {}, keys: {} }, player: {x:100,y:100,radius:10,angle:0},
    map: { worldRooms:[],doors:[],terminals:[],blocked:()=>false,rayWallDistance:(x,y,dx,dy,d)=>d },
    _onlineCoopPlayers(){return [this.player];},_remoteEntryForActor(){return null;},hunters:[],nightmares:[],heavies:[] };
  return { g, e:new C(g) };
}
test('barrier grid blocks movement, survives without a hidden count cap and updates after removal',()=>{
  const {g,e}=equipment();
  for(let i=0;i<400;i++) e.apply({id:`m:${i+1}`,seq:i+1,kind:'barrier-add',data:{id:`b${i}`,x:i*150,y:300,w:128,h:16,hp:20}},true);
  assert.equal(g.state.barriers.length,400);assert.equal(g.map.movementBarrierAt(40,305,10).id,'b0');
  e.apply({id:'m:401',seq:401,kind:'barrier-remove',data:{id:'b0'}},true);
  assert.equal(g.map.movementBarrierAt(40,305,10),null);assert.equal(g.state.barriers.length,399);
});
test('duplicate reliable events cannot duplicate permanent magazines or barrier damage',()=>{
  const {g,e}=equipment(), msg={id:'m:1',seq:1,kind:'debris',data:{id:'mag1',kind:'magazine',x:200,y:200,angle:0,born:0}};
  e.apply(msg,true);e.apply(msg,true);assert.equal(g.state.magazines.length,1);
  g.state.elapsed=10000;e.updateVisuals();assert.equal(g.state.magazines.length,1);
});
test('casings fade after eight seconds, expire after ten, and remain bounded',()=>{
  const {g,e}=equipment();for(let i=0;i<700;i++)e.addCasing({x:0,y:0,angle:0},`shot${i}`);
  assert.equal(g.state.casings.length,600);g.state.elapsed=9;e.updateVisuals();assert.equal(g.state.casings.length,600);
  g.state.elapsed=10.1;e.updateVisuals();assert.equal(g.state.casings.length,0);
});
test('full state recovery does not replay effects and stale data cannot erase a new barrier',()=>{
  const {g,e}=equipment();e.apply({id:'m:2',seq:2,kind:'barrier-add',data:{id:'b',x:0,y:0,w:128,h:16,hp:20}},true);
  assert.equal(e.restore({missionId:'m',revision:1,barriers:[],magazines:[]}),false);
  assert.equal(g.state.barriers.length,1);
});
test('large permanent history is paged below 32KB and applied only when complete',()=>{
  const {g,e}=equipment();assert.equal(typeof e.queueFull,'function');
  for(let i=0;i<2000;i++)e.event('debris',{id:`mag${i}`,kind:'magazine',x:i,y:1,born:0,angle:0});
  const sent=[];g.coopSession={sendEvent:(type,msg)=>{sent.push({type,...msg});return true;}};
  e.queueFull('peer');while(e.transfers.size)e.pumpTransfers();
  assert.ok(sent.length>1);assert.ok(sent.every(msg=>Buffer.byteLength(JSON.stringify(msg))<=32000));
  const receiver=equipment();receiver.g.state.coop={role:'guest',running:true};receiver.g.coopSession={sendEvent:()=>true};
  for(let i=0;i<sent.length-1;i++)receiver.e.receivePage(sent[i]);
  assert.equal(receiver.g.state.magazines.length,0);assert.equal(receiver.g.state.equipmentSyncing,true);
  receiver.e.receivePage(sent.at(-1));assert.equal(receiver.g.state.magazines.length,2000);assert.equal(receiver.g.state.equipmentSyncing,false);
});
test('a lost equipment delta forces resync rather than advancing past a missing obstacle',()=>{
 const {g,e}=equipment(),requests=[];g.coopSession={sendEvent:(type,msg)=>requests.push({type,...msg})};
 assert.equal(e.apply({missionId:'m',id:'m:2',seq:2,kind:'barrier-add',data:{id:'b2',x:0,y:0,w:128,h:16,hp:20}}),false);
 assert.equal(e.revision,0);assert.equal(g.state.equipmentSyncing,true);assert.equal(requests[0].type,'equipment-state-request');
});
test('mission reset baselines old reload serials without inventing a spawn magazine',()=>{
 const {g,e}=equipment();g.player.reloadSerial=4;e.reset();e.updateActions();assert.equal(g.state.magazines.length,0);
 g.player.reloadSerial=5;e.updateActions();assert.equal(g.state.magazines.length,1);
});
test('Hunter visual identity matches reconstructed peers and lethal effects reach its corpse',()=>{
 const {g,e}=equipment();const host={spawnIndex:3,lifeId:'host-life'},guest={spawnIndex:3};
 assert.equal(e.enemyKey(host),e.enemyKey(guest));
 const record={effectKey:e.enemyKey(host)};g.corpseRegistry=[record];g.state.corpses=[{...record}];
 e.showHit({key:e.enemyKey(host),amount:2,born:0,x:100,y:100});
 assert.equal(record.hitFlashUntil,.08);assert.equal(g.state.corpses[0].hitFlashUntil,.08);
});
