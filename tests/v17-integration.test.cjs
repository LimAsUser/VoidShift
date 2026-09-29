const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={console,performance,structuredClone,window:{addEventListener(){}},document:{getElementById:()=>null},setTimeout,clearTimeout};
for(const f of ['config','inventory','entities','map','equipment','loot','game'])vm.runInNewContext(fs.readFileSync(`js/${f}.js`,'utf8'),context);
const {Game,Player,Hunter,Heavy,Monster,Flashbang,MapManager,EquipmentController,BackpackManager,LootController,Config}=vm.runInNewContext('({Game,Player,Hunter,Heavy,Monster,Flashbang,MapManager,EquipmentController,BackpackManager,LootController,Config})',context);
function fixture(){
 const g=Object.create(Game.prototype);g.state={running:true,elapsed:0,missionFxId:'m',keys:{},coop:{role:null,playerId:'host'},mouseX:180,mouseY:100,inventory:[]};
 g.player=new Player();Object.assign(g.player,{x:100,y:100,angle:0});g.backpack=BackpackManager.fromType('field');g.remotePlayers=new Map();g.hunters=[];g.nightmares=[];g.heavies=[];
 g.map=Object.assign(Object.create(MapManager.prototype),{worldW:1000,worldH:1000,walls:[],doors:[],terminals:[],worldRooms:[],containers:[],getRoomAt:()=>null});
 g.ui={showToast(){},log(){},updateSkillReadout(){}};g.audio={};g._save=g.updateMoneyUI=g.updateAmmoDepotUI=g._notifyTransaction=g._syncPreparedBackpack=g.updateInventoryUI=g._tutorialAction=g.handleAim=()=>{};
 g.coopSession={sendEvent:()=>true};g.equipment=new EquipmentController(g);return g;
}
test('barrier requires preview/confirmation, ignores bullets/light, blocks bodies and rejects overlap without cooldown',()=>{
 const g=fixture();g.player.armory.ownedSkills.barrier=true;g.player.armory.equippedSkill='barrier';
 assert.equal(g.useSkill(),false);assert.ok(g.state.barrierBlueprint);assert.equal(g.state.barriers.length,0);
 assert.equal(g.useSkill(),true);assert.equal(g.player.skillReadyAt,30);assert.equal(g.state.barriers.length,1);
 const b=g.state.barriers[0];assert.equal(g.map.blocked(b.x+10,b.y+5,10),true);
 assert.equal(g.map.rayWallDistance(100,100,1,0,250),250);
 g.state.elapsed=30;assert.equal(g.useSkill(g.player,180,100,{vertical:false}),false);assert.equal(g.player.skillReadyAt,30);
});
test('three-second continuous removal succeeds once, moving/releasing cancels without refunds',()=>{
 const g=fixture();g.equipment.event('barrier-add',{id:'b',x:145,y:70,w:16,h:60,hp:20});g.state.keys.e=true;
 assert.equal(g.equipment.beginRemoval(g.player),true);g.state.elapsed=2.9;g.equipment.updateActions();assert.equal(g.state.barriers.length,1);
 g.state.keys.e=false;g.equipment.updateActions();assert.equal(g.player.barrierRemoval,null);
 g.state.keys.e=true;g.equipment.beginRemoval(g.player);g.state.elapsed=5.9;g.equipment.updateActions();g.equipment.updateActions();assert.equal(g.state.barriers.length,0);
});
test('Heavy charges into a barrier, removes five HP and still stuns when destroying it',()=>{
 const g=fixture(),heavy=new Heavy(5);Object.assign(heavy,{id:'h',x:100,y:100,active:true,phase:'charge',chargeAngle:0});
 g.equipment.event('barrier-add',{id:'b',x:160,y:50,w:16,h:128,hp:5});
 const result=heavy.update(.2,{x:300,y:100,radius:10},g.map,[]);
 assert.equal(result.wallImpact.barrierId,'b');g.equipment.damage('b',5);
 assert.equal(g.state.barriers.length,0);assert.equal(heavy.phase,'stunned');assert.equal(heavy.stunTimer,3);
});
test('new weapon ammunition purchases do not spend standard units and respect ownership/price',()=>{
 const g=fixture();g.state.running=false;g.state.money=1000;g.player.unlockWeapon('machinegun');
 const standard=g.player.armory.standardAmmoUnits;
 assert.equal(g.purchaseWeaponAmmo('machinegun'),true);assert.equal(g.state.money,800);
 assert.equal(g.player.armory.weaponAmmo.machinegun.reserve,100);assert.equal(g.player.armory.standardAmmoUnits,standard);
 assert.equal(g.purchaseWeaponAmmo('mini-shotgun'),false);assert.equal(g.state.money,800);
});
test('real projectile path applies machinegun damage, groups pellet feedback and never reports armored hits',()=>{
 const g=fixture(),h=new Hunter(0,5);Object.assign(h,{active:true,x:200,y:100});g.hunters=[h];
 g.player.unlockWeapon('machinegun');g.player.equipWeapon('primary','machinegun');g.player.switchWeaponSlot('primary');g._feedbackShotId='shot';
 g._applyProjectileHit(h,g.player,0);assert.equal(h.hp,3);assert.equal(g.state.damageNumbers[0].amount,2);
 g._applyProjectileHit(h,g.player,0);assert.equal(g.state.damageNumbers.length,1);assert.equal(g.state.damageNumbers[0].amount,4);
 const heavy=new Heavy(5);Object.assign(heavy,{id:'armor',active:true,x:300,y:100});g.heavies=[heavy];
 g._applyProjectileHit(heavy,g.player,0);assert.equal(heavy.hp,5);assert.equal(g.state.damageNumbers.length,1);
});
test('Guest waits for authoritative map before generating any solo preview',()=>{
 const g=fixture();g.state.coop={role:'guest',previewReady:false};g._ensureMenuMapSeeds=()=>{throw Error('local seeds must not be used');};
 assert.equal(g.getMenuPreviewMap('small'),null);
});
test('supplies and shield runtime survive player snapshots while request IDs prevent replay consumption',()=>{
 const g=fixture(),remote=new Player();remote.supplyUse={itemId:'med',effect:'health-40',endsAt:2};remote.shieldUntil=3;remote.shieldReadyAt=50;
 const snapshot=g._playerSnapshot(remote);g._applyPlayerSnapshot(g.player,snapshot);
 assert.equal(g.player.supplyUse.itemId,'med');assert.equal(g.player.shieldReadyAt,50);
});
test('task inventory sale messages no longer mutate money or contents',async()=>{
 const g=fixture();g.state.coop={role:'host'};g.state.money=100;g.backpack.items=[{id:'x',value:200}];
 await g._handleCoopMessage('events',{type:'inventory-sell',items:['x']},'peer');
 assert.equal(g.state.money,100);assert.equal(g.backpack.items.length,1);assert.equal(typeof g.sellInventory,'undefined');
});
test('skill projectiles pass through magnetic barriers but still bounce from real walls',()=>{
 const g=fixture();g.equipment.event('barrier-add',{id:'b',x:160,y:50,w:16,h:128,hp:20});
 const grenade=new Flashbang('g','host',100,100,300,100,'grenade');
 for(let i=0;i<8;i++)grenade.update(.05,g.map);
 assert.ok(grenade.x>180,'grenade traverses movement-only barrier');assert.equal(g.state.barriers[0].hp,20);
});
test('scene restoration freezes local predicted shooting before ammo or effects change',()=>{
 const g=fixture();g.state.coop={role:'guest',running:true};g.state.equipmentSyncing=true;g.advanceCamera=()=>{};
 let shots=0;g.player.shoot=()=>{shots++;return {fired:false};};g.shoot();assert.equal(shots,0);
});
test('two to four participants keep timed supply requests personal and idempotent',()=>{
 for(const count of [2,3,4]){
  const g=fixture();g.state.coop={running:true,role:'host',playerId:'host',members:[]};
  for(let slot=2;slot<=count;slot++){
   const id=`p${slot}`,player=new Player(),backpack=BackpackManager.fromType('field');player.health=40;
   backpack.items=[{id:`med${slot}`,effect:'health-40'},{id:`spare${slot}`,effect:'health-40'}];
   g.remotePlayers.set(id,{id,slot,player,backpack,inventory:backpack.items,online:true,input:{keys:{}}});
   const message={action:'use-supply',missionId:'m',requestId:1,itemId:`med${slot}`};
   g._handleRemoteAction(message,id);g._handleRemoteAction(message,id);assert.equal(player.health,40);
  }
  g.state.elapsed=2;g._updateSupplyUses();
  for(const [id,entry]of g.remotePlayers){
   assert.equal(entry.player.health,80);assert.equal(entry.backpack.items.length,1);
   g._handleRemoteAction({action:'use-supply',missionId:'m',requestId:1,itemId:entry.backpack.items[0].id},id);
   assert.equal(entry.player.supplyUse,null);assert.equal(entry.backpack.items.length,1);
  }
 }
});
test('Guest confirmed seed difficulty scale and signature replace stale solo preview without re-rolling',async()=>{
 const g=fixture();g.state.coop={role:'guest',playerId:'guest',rosterRevision:0,members:[]};g.state.menuMapSeeds={small:9,medium:8,large:7};
 g.updateCoopUI=()=>{};const seed=34567;const expected=new MapManager('small',seed,'easy').layoutSignature();
 await g._handleCoopMessage('events',{type:'room-roster',revision:1,hostReady:false,difficulty:'easy',scale:'small',
  mapSeeds:{small:seed,medium:88888,large:99999},mapSignature:expected,members:[]});
 assert.equal(g.state.coop.previewReady,true);assert.equal(g.getMenuPreviewMap('small').layoutSignature(),expected);
 assert.equal(g.getMenuPreviewMap('small').seed,seed);
});
test('Guest entering a barrier blueprint cancels its authoritative supply before a placement request',()=>{
 const g=fixture(),messages=[];g.state.coop={role:'guest',running:true};
 g.player.armory.ownedSkills.barrier=true;g.player.armory.equippedSkill='barrier';
 g.player.supplyUse={itemId:'med',effect:'health-40',endsAt:2};g.coopSession.sendEvent=(type,data)=>{messages.push(data);return true;};
 assert.equal(g.useSkill(),false);assert.equal(g.player.supplyUse,null);assert.ok(g.state.barrierBlueprint);
 assert.ok(messages.some(m=>m.action==='cancel-supply'));
});
