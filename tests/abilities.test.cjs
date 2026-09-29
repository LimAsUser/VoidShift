const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test'),vm=require('node:vm');
let saved=null;
const box={window:{addEventListener(){}},structuredClone,performance:{now:()=>1000},localStorage:{getItem:()=>saved,setItem:(_k,v)=>saved=v}};
for(const name of ['config','inventory','entities','game'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js',name+'.js'),'utf8'),box);
const {Game,Player,Hunter,Heavy,Monster,Flashbang,BackpackManager,Config}=vm.runInNewContext('({Game,Player,Hunter,Heavy,Monster,Flashbang,BackpackManager,Config})',box);
function game(){const g=Object.create(Game.prototype);g.state={money:30000,running:false,elapsed:0,coop:{},keys:{},inventory:[],remoteInventory:[],storageItems:[],storageOverflowItems:[],storageCapacity:100,flashbangs:[],flashBursts:[]};
g.map={seed:1,spawnPoint:{x:100,y:100},blocked:()=>false,rayWallDistance:(_x,_y,_dx,_dy,limit)=>limit,worldRooms:[],doors:[]};
g.player=new Player();g.player.reset(g.map);g.backpack=BackpackManager.fromType('field');g.remoteBackpack=BackpackManager.fromType('field');g.remotePlayers=new Map();g._bindBackpackInventories();g._initializeStorage();
g.ui={showToast(){},log(){},updateFlashbangs(){},updateAbilities(){},updateSkillReadout(){},formatCreditText:String};
for(const name of ['updateMoneyUI','updateStorageUI','updateLoadoutUI','updateInventoryUI','updateAmmoDepotUI','_syncPreparedBackpack','_notifyTransaction'])g[name]=()=>{};
g.audio={};g.monster=new Monster();g.monster.active=false;g.hunters=[];return g;}
function own(g,kind,id){assert.equal(g.purchaseAbility(kind,id),true);assert.equal(g.equipAbility(kind,id),true);}

test('abilities are paid permanent unlocks, do not auto-equip, and normalize to one owned choice',()=>{
 const g=game();assert.equal(g.player.armory.equippedSkill,null);assert.equal(g.player.armory.equippedPassive,null);
 for(const [kind,id,price] of [['skill','flashbang',1000],['skill','grenade',5000],['passive','roll',7000],['passive','life-scan',4000]]){
  const before=g.state.money;assert.equal(g.purchaseAbility(kind,id),true);assert.equal(g.state.money,before-price);
  assert.equal(g.purchaseAbility(kind,id),false);assert.equal(g.state.money,before-price);
 }
 assert.equal(g.player.armory.equippedSkill,null);g.equipAbility('skill','flashbang');g.equipAbility('skill','grenade');
 assert.equal(g.player.armory.equippedSkill,'grenade');g.equipAbility('passive','roll');g.equipAbility('passive','life-scan');
 assert.equal(g.player.armory.equippedPassive,'life-scan');
 g.state.running=true;assert.equal(g.equipAbility('passive','roll'),false);
 const normalized=Player.normalizeArmory({equippedSkill:'grenade',equippedPassive:'roll'});
 assert.equal(normalized.equippedSkill,null);assert.equal(normalized.equippedPassive,null);
});

test('owned and equipped abilities survive save/load and co-op armory export',()=>{
 const g=game();own(g,'skill','grenade');own(g,'passive','life-scan');g._save();
 const copy=game();copy._loadSave();
 assert.equal(copy.player.armory.ownedSkills.grenade,true);assert.equal(copy.player.armory.equippedSkill,'grenade');
 assert.equal(copy.player.armory.ownedPassives['life-scan'],true);assert.equal(copy.player.armory.equippedPassive,'life-scan');
 const snapshot=g._playerSnapshot(g.player);const remote=new Player();g._applyPlayerSnapshot(remote,snapshot);
 assert.equal(remote.armory.equippedSkill,'grenade');assert.equal(remote.armory.equippedPassive,'life-scan');
});

test('roll is unavailable without its equipped passive and preserves original stamina and distance when equipped',()=>{
 const g=game();assert.equal(g.player.startRoll(1,0),false);own(g,'passive','roll');
 assert.equal(g.player.startRoll(1,0),true);assert.equal(g.player.stamina,80);assert.equal(g.player.dodgeTimer,.35);
});

test('skill use consumes no cargo, starts only successful cooldown and respects mission restrictions',()=>{
 const g=game();own(g,'skill','flashbang');g.state.running=true;
 assert.equal(g.useSkill(g.player,300,100),true);assert.equal(g.player.skillReadyAt,15);assert.equal(g.backpack.items.length,0);
 assert.equal(g.useSkill(g.player,300,100),false);assert.equal(g.state.flashbangs.length,1);
 g.state.elapsed=15;g.player.downed=true;assert.equal(g.useSkill(g.player,300,100),false);assert.equal(g.player.skillReadyAt,15);
 g.player.downed=false;assert.equal(g.useSkill(g.player,300,100),true);assert.equal(g.player.skillReadyAt,30);
 g.player.reset(g.map,g.player.exportArmory());assert.equal(g.player.skillReadyAt,0);
});

test('grenade bypasses Heavy armor, hits Monster five times, respects walls, friendly fire and roll immunity',()=>{
 const g=game();g.state.running=true;g.state.coop={running:true,role:'host',playerId:'host',friendlyFire:false};
 const mate=new Player();mate.reset(g.map);mate.x=125;g.remotePlayers.set('guest',{id:'guest',player:mate,online:true,inventory:[]});
 g.coopSession={sendEvent(){}};g.heavy=new Heavy(20);g.heavy.activate(130,100);g.monster.active=true;g.monster.x=140;g.monster.y=100;
 const hunter=new Hunter();hunter.active=true;hunter.hp=8;hunter.x=150;hunter.y=100;g.hunters=[hunter];
 g._explodeGrenade({id:'g1',ownerId:'host',x:100,y:100,skillId:'grenade'});
 assert.equal(g.player.health,95);assert.equal(mate.health,100);assert.equal(g.heavy.hp,15);assert.equal(hunter.hp,3);
 assert.equal(g.monster.recoverTimer,20);assert.equal(g.heavy.phase,'pursuit');
 assert.equal(g.heavy.registerHit(1).hit,false);
 g.state.coop.friendlyFire=true;mate.dodgeTimer=.2;g.map.rayWallDistance=()=>0;
 g._explodeGrenade({id:'g2',ownerId:'host',x:100,y:100,skillId:'grenade'});
 assert.equal(mate.health,100);assert.equal(g.heavy.hp,15);
 g.map.rayWallDistance=(_x,_y,_dx,_dy,limit)=>limit;
 g._explodeGrenade({id:'g3',ownerId:'host',x:100,y:100,skillId:'grenade'});assert.equal(mate.health,100);
 mate.dodgeTimer=0;mate.invulnerableThisFrame=false;
 g._explodeGrenade({id:'g4',ownerId:'host',x:100,y:100,skillId:'grenade'});assert.equal(mate.health,95);
});

test('new and legacy saves receive one grant and physical/scalar flashbang refunds only once',()=>{
 saved=null;const fresh=game();fresh._loadSave();assert.equal(fresh.player.armory.standardAmmoUnits,1000);assert.equal(fresh.backpack.items.length,5);
 assert.ok(fresh.backpack.items.every(i=>i.shape==='1x2'&&i.effect==='oxygen-50'));fresh._save();
 const repeat=game();repeat._loadSave();assert.equal(repeat.player.armory.standardAmmoUnits,1000);assert.equal(repeat.backpack.items.length,5);
 const legacy=game();legacy.backpack.place({...Config.consumables.flashbang,id:21});legacy.storageBackpack.place({...Config.consumables.flashbang,id:22});
 saved=JSON.stringify({money:99,armoryVersion:1,armory:legacy.player.exportArmory(),flashbangInventoryVersion:1,
  backpackItems:legacy.backpack.items,storageItems:legacy.storageBackpack.items,storageOverflowItems:[{...Config.consumables.flashbang,id:23}]});
 const upgraded=game();upgraded._loadSave();assert.equal(upgraded.state.money,1599);assert.equal(upgraded.player.armory.standardAmmoUnits,1000);
 assert.equal(upgraded.backpack.items.filter(i=>i.effect==='flashbang').length,0);upgraded._save();
 const again=game();again._loadSave();assert.equal(again.state.money,1599);assert.equal(again.backpack.items.length,5);
 saved=JSON.stringify({money:100,flashbangCount:2});const scalar=game();scalar._loadSave();assert.equal(scalar.state.money,1100);
});

test('full bag and warehouse preserve five granted bottles in overflow; no repeat grant after loss',()=>{
 const g=game();for(const bag of [g.backpack,g.storageBackpack])while(bag.place({name:'cargo',shape:'1x1',value:1})){}
 saved=JSON.stringify({money:10,armoryVersion:1,armory:g.player.exportArmory(),backpackItems:g.backpack.items,storageItems:g.storageBackpack.items});
 g._loadSave();assert.equal(g.state.storageOverflowItems.filter(i=>i.effect==='oxygen-50').length,5);
 g.backpack.clear();g._save();const next=game();next._loadSave();assert.equal(next.backpack.items.length,0);
 assert.equal(next.player.armory.standardAmmoUnits,1000);
});

test('oxygen is charged once per online upright player at .10/.30 and is independent of extraction call',()=>{
 const g=game();const mate=new Player();mate.reset(g.map);g.remotePlayers.set('guest',{id:'guest',player:mate,online:true});
 g.state.coop={running:true,role:'host',playerId:'host'};
 g._drainOxygen(10);assert.equal(g.player.oxygen,99);assert.equal(mate.oxygen,99);
 g.state.extractionCalled=true;g._drainOxygen(10);assert.equal(g.player.oxygen,98);
 g.state.finalTerminalPressure=true;g._drainOxygen(10);assert.equal(g.player.oxygen,95);assert.equal(mate.oxygen,95);
 mate.downed=true;g._drainOxygen(10);assert.equal(mate.oxygen,95);assert.equal(g.player.oxygen,92);
});

test('guest skill requests are host-confirmed, deduplicated and do not start local cooldown prematurely',()=>{
 const guest=game();own(guest,'skill','grenade');guest.state.running=true;guest.state.coop={running:true,role:'guest'};
 const requests=[];guest.coopSession={sendEvent:(type,message)=>{requests.push({type,...message});return true;}};
 assert.equal(guest.useSkill(guest.player,300,100),true);assert.equal(guest.useSkill(guest.player,300,100),false);
 assert.equal(guest.player.skillReadyAt,0);assert.equal(requests.length,1);
 const host=game();host.state.running=true;host.state.coop={running:true,role:'host',playerId:'host'};
 host.remotePlayers.set('guest',{id:'guest',player:guest.player,online:true,input:{},inventory:[]});
 host.coopSession={sendEvent(){}};host._handleRemoteAction(requests[0],'guest');host._handleRemoteAction(requests[0],'guest');
 assert.equal(host.state.flashbangs.length,1);assert.equal(host.state.flashbangs[0].skillId,'grenade');assert.equal(guest.player.skillReadyAt,20);
});

test('a refreshed guest resumes the authoritative skill request sequence instead of getting stuck pending',()=>{
 const host=game(),guest=game();own(guest,'skill','grenade');
 host.state.running=true;host.state.elapsed=60;host.state.coop={running:true,role:'host',playerId:'host'};
 const actor=new Player();actor.configureArmory(guest.player.exportArmory());actor.skillReadyAt=50;
 const entry={id:'guest',player:actor,online:true,input:{},inventory:[],lastSkillRequestId:3};
 host.remotePlayers.set('guest',entry);const replies=[];host.coopSession={sendEvent:(type,message)=>replies.push({type,...message})};
 guest.state.running=true;guest.state.elapsed=60;guest.state.coop={running:true,role:'guest'};
 const requests=[];guest.coopSession={sendEvent:(type,message)=>{requests.push({type,...message});return true;}};
 guest._applyPlayerSnapshot(guest.player,host._playerSnapshot(actor));
 assert.equal(guest.useSkill(guest.player,300,100),true);assert.equal(requests[0].requestId,4);
 host._handleRemoteAction(requests[0],'guest');host._handleRemoteAction(requests[0],'guest');
 assert.equal(host.state.flashbangs.length,1);assert.equal(actor.skillReadyAt,80);
 guest._applyPlayerSnapshot(guest.player,host._playerSnapshot(actor));
 assert.equal(guest._pendingSkillRequest,null,'snapshot confirms an accepted request even if its acknowledgment was lost');
 const count=replies.length;host._handleRemoteAction({...requests[0],requestId:1},'guest');
 assert.equal(replies.length,count+1);assert.equal(replies.at(-1).accepted,false);assert.equal(replies.at(-1).lastRequestId,4);
 assert.equal(host.state.flashbangs.length,1);
});
