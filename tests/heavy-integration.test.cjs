const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const context = { window: { addEventListener() {} }, performance: { now: () => 1000 }, structuredClone };
for (const file of ['config', 'inventory', 'entities', 'game']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8'), context);
}
const Game = vm.runInNewContext('Game', context);
const Player = vm.runInNewContext('Player', context);
const Heavy = vm.runInNewContext('Heavy', context);
const BackpackManager = vm.runInNewContext('BackpackManager', context);
const cargo = count => Array.from({length:count},(_,i)=>({id:`cargo-${i}`,name:'cargo',shape:'1x1',value:250,gx:i%8,gy:Math.floor(i/8),rot:0}));
function stock(g,count){g.state.inventory=cargo(count);g._bindBackpackInventories();}
function equipSkill(g) {
  assert.equal(g.purchaseAbility('skill', 'flashbang'), true);
  assert.equal(g.player.armory.equippedSkill, null);
  assert.equal(g.equipAbility('skill', 'flashbang'), true);
}
function game() {
  const g = Object.create(Game.prototype);
  g.state = { running: false, elapsed: 0, money: 1000, skillInventoryMigrationVersion: 1, starterGrantVersion: 1, selectedDifficulty: 'medium', inventory: [], coop: { role: null, running: false, playerId: 'host' }, keys: {}, flashbangs: [], flashBursts: [] };
  g.player = new Player();
  g.remotePlayers = new Map();
  g.backpack=BackpackManager.fromType('field');g.remoteBackpack=BackpackManager.fromType('field');
  g._bindBackpackInventories();g._initializeStorage();
  g.map = { seed: 1, enemyTypes: ['heavy'], blocked: () => false, rayWallDistance: (_x, _y, _dx, _dy, d) => d };
  g.ui = { showToast() {}, updateSkillReadout() {}, updateFlashbangs() {} };
  g.updateMoneyUI = g.updateLoadoutUI = g.updateAmmoDepotUI = g._save = () => {};
  g.updateStorageUI=g.updateInventoryUI=()=>{};
  g.audio = { playTone() {} };
  g.coopSession = { sendEvent() {} };
  g._tutorialAction = () => {};
  return g;
}
test('skill unlock charges once without auto-equipping and refuses insufficient money or a running mission', () => {
  const g = game();
  assert.equal(g.purchaseAbility('skill', 'flashbang'), true);
  assert.equal(g.state.money, 0);
  assert.equal(g.player.armory.ownedSkills.flashbang, true);
  assert.equal(g.player.armory.equippedSkill, null);
  assert.equal(g.purchaseAbility('skill', 'flashbang'), false);
  g.state.money = 4999;
  assert.equal(g.purchaseAbility('skill', 'grenade'), false);
  g.state.money = 5000; g.state.running = true;
  assert.equal(g.purchaseAbility('skill', 'grenade'), false);
  assert.equal(g.state.money, 5000);
  assert.equal(g.backpack.items.length, 0);
});
test('encounter gates all absent enemy spawns and scales Heavy HP without scaling count', () => {
  const g = game();
  assert.deepEqual(Array.from(g._createHunters()), []);
  assert.equal(g._spawnNewHunters(8), 0);
  assert.equal(g.activateMonster('test'), false);
  assert.equal(g.teleportMonsterToNearbyRoom(), false);
  assert.equal(g._respawnDeadHunters(5), 0);
  g.state.coop.running = true; g.state.coop.difficultyMultiplier = 3;
  assert.equal(g._getHeavyMaxHp(), 90);
});
test('skill use starts cooldown, respects stun/unequipped restrictions and awaits guest authority', () => {
  const g = game(); equipSkill(g); g.state.running = true; stock(g,2);
  assert.equal(g.useSkill(g.player, 200, 100), true);
  assert.equal(g.player.skillReadyAt, 15);
  assert.equal(g.backpack.items.length, 2);
  assert.equal(g.state.flashbangs.length, 1);
  assert.equal(g.useSkill(g.player, 200, 100), false);
  g.state.elapsed = 15;
  g.player.flashStunTimer = 2;
  assert.equal(g.useSkill(g.player, 200, 100), false);
  g.player.flashStunTimer = 0;
  g.player.armory.equippedSkill = null;
  assert.equal(g.useSkill(g.player, 200, 100), false);
  g.player.armory.equippedSkill = 'flashbang';
  g.state.coop = { role: 'guest', running: true, playerId: 'guest' };
  g.coopSession = { sendEvent: () => true };
  assert.equal(g.useSkill(g.player, 200, 100), true);
  assert.equal(g.player.skillReadyAt, 15);
  assert.equal(g.backpack.items.length, 2);
  assert.equal(g.state.flashbangs.length, 1);
});
test('flash affects every visible player and enemy but not a target behind the wall', () => {
  const g = game();
  const target = (x,y) => ({x,y,active:true,applyFlashStun(s){this.flashStunTimer=s;}});
  g.player = target(0,0);
  const friend = target(20,0), blocked = target(-20,0);
  g._onlineCoopPlayers = () => [g.player, friend];
  g.monster = target(40,0); g.hunters = [blocked];
  g.heavy = { ...target(60,0), stun(s){this.stunTimer=s;} };
  g.map.rayWallDistance = (_x,_y,dx,_dy,d) => dx < 0 ? 5 : d;
  g._explodeFlashbang({id:'1',x:0,y:0});
  assert.equal(g.player.flashStunTimer, 5); assert.equal(friend.flashStunTimer, 5);
  assert.equal(g.monster.flashStunTimer, 5); assert.equal(blocked.flashStunTimer, undefined);
  assert.equal(g.heavy.stunTimer, 5);
});

test('host accepts equipped remote skills by peer identity and ignores forged choice/duplicate or invalid request', () => {
  const g = game(); g.state.running = true; g.state.coop = { running: true, role: 'host', playerId: 'host' };
  const remote = new Player(); remote.x = 20; remote.y = 20;
  remote.armory.ownedSkills.flashbang = true; remote.armory.equippedSkill = 'flashbang';
  const entry = {id:'guest',player:remote,online:true,inventory:cargo(2),input:{}};
  g.remotePlayers.set('guest', entry);
  const results = []; g.coopSession = { sendEvent(...args) { results.push(args); } };
  const message = {action:'use-skill',requestId:1,targetX:300,targetY:20,skillId:'grenade',skillReadyAt:0};
  g._handleRemoteAction(message, 'unknown');
  assert.equal(g.state.flashbangs.length, 0);
  g._handleRemoteAction(message, 'guest');
  g._handleRemoteAction(message, 'guest');
  assert.equal(g.state.flashbangs.length, 1); assert.equal(entry.inventory.length, 2);
  assert.equal(g.state.flashbangs[0].skillId, 'flashbang'); assert.equal(remote.skillReadyAt, 15);
  assert.equal(results[0][0], 'skill-result'); assert.equal(results[0][1].accepted, true);
  g._handleRemoteAction({...message,requestId:2,targetX:NaN}, 'guest');
  assert.equal(entry.inventory.length, 2); assert.equal(results.at(-1)[1].accepted, false);
  g._handleRemoteAction({...message,requestId:3}, 'guest');
  assert.equal(g.state.flashbangs.length, 1, 'new requests cannot bypass the host cooldown');
  g.state.elapsed = 15;
  g._handleRemoteAction({...message,requestId:4}, 'guest');
  assert.equal(entry.inventory.length, 2); assert.equal(remote.skillReadyAt, 30);
  assert.equal(g.state.flashbangs.length, 2);
});

test('blast at 80 units reaches target, 81 does not, and it is not gated by friendly fire', () => {
  const g = game(); const hits=[];
  g.state.coop.friendlyFire=false;
  g.player={x:0,y:0,applyFlashStun:s=>hits.push(['self',s])};
  const friend={x:80,y:0,applyFlashStun:s=>hits.push(['friend',s])};
  g.remotePlayers.set('friend',{id:'friend',player:friend,online:true});
  g._onlineCoopPlayers=()=>[g.player,friend];
  g.monster={active:true,x:81,y:0,applyFlashStun:()=>hits.push(['far'])}; g.hunters=[];
  g._explodeFlashbang({id:'edge',x:0,y:0});
  assert.deepEqual(hits,[['self',5],['friend',5]]);
});

test('Heavy knockback cannot pass through a wall or teammate', () => {
  const g=game(); g.player.x=0;g.player.y=0;
  g.map.blocked=(x)=>x>=12;
  g._knockbackPlayer(g.player,0,50);
  assert.equal(g.player.x,10);
  g.player.x=0;g.map.blocked=()=>false;
  g.remotePlayers.set('g',{id:'g',online:true,player:{x:30,y:0,radius:10}});
  g._knockbackPlayer(g.player,0,50);
  assert.equal(g.player.x,10);
});

test('explosion presentation deduplicates reliable events', () => {
  const g=game(); const effect={id:'effect',x:2,y:3};
  g._showFlashBurst(effect);g._showFlashBurst(effect);
  assert.equal(g.state.flashBursts.length,1);
});

test('skill ownership and selection survive save/load alongside unrelated cargo and weapon stock', () => {
  const g=game();equipSkill(g);stock(g,7);
  let saved;
  context.localStorage={setItem(_key,value){saved=JSON.parse(value);},getItem(){return JSON.stringify(saved);}};
  Game.prototype._save.call(g);
  assert.equal(saved.flashbangCount,undefined);assert.equal(saved.backpackItems.length,7);assert.equal(saved.money,0);
  assert.equal(saved.armory.ownedSkills.flashbang,true);assert.equal(saved.armory.equippedSkill,'flashbang');
  const h=game();
  h._loadSave();
  assert.equal(h.backpack.items.length,7);assert.equal(h.player.armory.ownedSkills.flashbang,true);
  assert.equal(h.player.armory.equippedSkill,'flashbang');assert.equal(h.state.money,0);
  assert.equal(h.player.reserveAmmo,g.player.reserveAmmo);
  saved.flashbangCount=99;
  h._loadSave();assert.equal(h.backpack.items.length,7,'migrated saves do not create items from a stale scalar');
  assert.equal(h.state.money,0,'migrated saves do not repeat the old stock refund');
});

test('host snapshot carries four personal inventories, equipped skills and Heavy/projectile states', () => {
  const g=game();equipSkill(g);g.state.coop={running:true,role:'host',playerId:'host'};
  stock(g,2);g.state.elapsed=1;g.state.bulletTraces=[];g.state.impactParticles=[];
  g.map.worldRooms=[];g.map.doors=[];g.map.scrap=[];g.map.terminals=[];
  g.monster={};g.hunters=[];
  g.heavies=[{id:'heavy-1',active:true,hp:90,maxHp:90,x:200,y:100,angle:0,radius:44,phase:'windup',phaseTimer:1.5,chargeAngle:0,stunTimer:0},
    {id:'heavy-2',active:true,hp:90,maxHp:90,x:500,y:100,angle:0,radius:44,phase:'pursuit',phaseTimer:0,chargeAngle:0,stunTimer:0}];
  g.state.missionFxId='snapshot-test';
  const events=[];g.coopSession.sendEvent=(type,message)=>events.push({type,...message});
  g.state.flashbangs=[{id:'f1',ownerId:'g2',x:50,y:60,remainingDistance:80,landed:false,fuse:1}];
  for(let i=2;i<=4;i++){
    const player=new Player();player.armory.ownedSkills.flashbang=true;player.armory.equippedSkill='flashbang';player.skillReadyAt=i*10;
    g.remotePlayers.set(`g${i}`,{id:`g${i}`,slot:i,player,online:true,inventory:cargo(i+2)});
  }
  const snapshot=g._createCoopSnapshot();
  assert.deepEqual(Array.from(snapshot.players,p=>p.inventory.length),[2,4,5,6]);
  assert.deepEqual(Array.from(snapshot.players,p=>p.state.armory.equippedSkill),['flashbang','flashbang','flashbang','flashbang']);
  assert.equal(snapshot.heavies[0].hp,90);assert.equal(snapshot.heavies.length,2);
  assert.equal('corpses' in snapshot,false);assert.equal('heavy' in snapshot,false);
  assert.equal(snapshot.flashbangs[0].ownerId,'g2');
  const guest=game();guest.state.coop={running:true,role:'guest',playerId:'g3'};
  guest.map.worldRooms=[];guest.map.terminals=[];guest.map.doors=[];guest.map.scrap=[];
  guest.monster={};guest.hunters=[];guest.ui.updateTerminalsStatus=()=>{};
  guest.state.missionFxId='snapshot-test';
  guest._applyCoopSnapshot(snapshot);
  assert.equal(guest.backpack.items.length,5);assert.equal(guest.heavy.phase,'windup');
  assert.equal(guest.heavies.length,2);
  assert.equal(guest.player.armory.equippedSkill,'flashbang');assert.equal(guest.player.skillReadyAt,30);
  assert.equal(guest.state.flashbangs.length,1);
  Object.assign(g.heavy,{active:false,dead:true,phase:'stunned',corpseTime:1.25});
  g._syncEnemyCorpses();
  guest._applyCoopSnapshot(g._createCoopSnapshot());
  guest._handleCoopMessage('events',events.at(-1));
  assert.equal(guest.heavy.dead,true);assert.equal(guest.state.corpses.length,1);
  assert.equal(guest.state.corpses[0].kind,'heavy');
  g.heavies=[];guest._applyCoopSnapshot(g._createCoopSnapshot());
  assert.equal(guest.heavies.length,0,'authoritative absence removes obsolete live objects');
  assert.equal(guest.state.corpses.length,1,'old body remains independent of actor collection');
});

test('small map Heavy replenishment respects its single slot and party-scaled HP', () => {
  const g=game();g.map.monsterSpawns=[{x:400,y:400}];
  g.state.coop={running:true,role:'host',playerId:'host',difficultyMultiplier:2};
  assert.equal(g._spawnHeavy(),true);assert.equal(g.heavy.maxHp,60);
  const first=g.heavy;
  assert.equal(g._spawnHeavy(),false);assert.equal(g.heavy,first);
  g.heavy.dead=true;g.heavy.active=false;
  assert.equal(g._spawnHeavy(),true);assert.notEqual(g.heavy,first);
  assert.equal(g.heavy.hp,60);assert.equal(g.state.heavies[0],g.heavy);
});

test('host ignores flashlight input while a remote player is flash-stunned', () => {
  const g=game();g.state.coop={running:true,role:'host',playerId:'host'};
  const player=new Player();player.flashlight=true;player.flashStunTimer=2;
  g.remotePlayers.set('g',{id:'g',player,online:true,input:{keys:{},flashlight:false}});
  g._syncLegacyRemoteAliases=()=>{};
  g._updateRemotePlayers(0.05);
  assert.equal(player.flashlight,true);
});

test('Heavy can threaten a player standing inside its radius instead of following forever', () => {
  const heavy=new Heavy(20);heavy.activate(0,0);
  const target={x:15,y:0,radius:10};
  const map={worldRooms:[],getRoomAt:()=>null,blocked:()=>false,rayWallDistance:(_x,_y,_dx,_dy,d)=>d};
  heavy.update(.05,target,map,[target]);
  assert.equal(heavy.phase,'windup');
});

test('Heavy can charge a visible wall-hugging player when its body can reach contact range', () => {
  const heavy=new Heavy(20);heavy.activate(0,0);
  const target={x:78,y:0,radius:10};
  const map={worldRooms:[],getRoomAt:()=>null,blocked:(x,_y,r)=>x+r>=90,rayWallDistance:(_x,_y,_dx,_dy,d)=>d};
  heavy.update(.05,target,map,[target]);
  assert.equal(heavy.phase,'windup');
});

test('skill use recalculates a stationary mouse against the players current camera position', () => {
  const g=game();const config=vm.runInNewContext('Config',context);
  equipSkill(g);g.state.running=true;
  g.player.x=100;g.player.y=100;
  const rect={left:0,top:0,width:config.VIEW_W,height:config.VIEW_H};
  g.ui.frame={getBoundingClientRect:()=>rect};
  g.handleAim({clientX:rect.width/2+100,clientY:rect.height/2});
  g.player.y=200;
  assert.equal(g.useSkill(),true);
  assert.equal(g.state.flashbangs[0].angle,0);
  assert.ok(Math.abs(g.state.flashbangs[0].remainingDistance-100/1.56)<1e-8);
});
