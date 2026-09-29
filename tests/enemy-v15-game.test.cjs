const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
let saved = null;
const context = vm.createContext({ window:{ addEventListener(){}, matchMedia:()=>({matches:false}) },
  localStorage:{getItem:()=>saved,setItem:(_key,value)=>{saved=value;}}, performance:{now:()=>1000}, setTimeout, clearTimeout });
for (const file of ['config','map','entities','game']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',`${file}.js`),'utf8'),context);
const { Game,Heavy,Config } = vm.runInContext('({Game,Heavy,Config})',context);
function game() {
  const g=Object.create(Game.prototype);
  g.state={running:true,elapsed:0,corpseLimit:100,corpses:[],missionFxId:'mission-a',selectedDifficulty:'medium',coop:{running:false,role:null},cameraZoom:1.56};
  g.player={x:0,y:0,radius:10};g.monster={active:false};g.hunters=[];g.heavies=[];
  g.remotePlayers=new Map();g.ui={updateCorpseLimit(){}};g._save=()=>{};
  g.coopSession={sendEvent(){}};
  g._onlineCoopPlayers=()=>[g.player];
  return g;
}
test('saved custom enemy counts double once, missing fields use new defaults, HP and intervals stay unchanged',()=>{
  const g=game();
  const data={difficultyProfiles:{medium:{maps:{small:{hunters:73,hunterRespawnCount:4,hunterMaxHp:8,hunterSpawnInterval:31}},finalTerminalSpawnCount:9,finalTerminalSpawnInterval:27}}};
  const profiles=g._migrateEnemyCounts(data);
  assert.equal(profiles.medium.maps.small.hunters,146);
  assert.equal(profiles.medium.maps.small.hunterRespawnCount,8);
  assert.equal(profiles.medium.maps.small.hunterMaxHp,8);
  assert.equal(profiles.medium.maps.small.hunterSpawnInterval,31);
  assert.equal(profiles.medium.maps.medium.hunters,Config.difficultyPresets.medium.maps.medium.hunters);
  assert.equal(profiles.medium.finalTerminalSpawnCount,18);
  assert.equal(profiles.medium.finalTerminalSpawnInterval,27);
  assert.equal(g._migrateEnemyCounts({difficultyProfiles:profiles,enemyCountMigrationVersion:1}).medium.maps.small.hunters,146);
  assert.equal(data.difficultyProfiles.medium.maps.small.hunters,73);
});
test('Heavy map limits are 1/2/3 and each replenishment fills only one vacancy without overlapping living bodies',()=>{
  for(const [scale,count] of [['small',1],['medium',2],['large',3]]) {
    Config.currentScale=scale;const g=game();
    g.map={enemyTypes:['heavy'],blocked:()=>false,monsterSpawns:[{x:500,y:0},{x:800,y:0},{x:1100,y:0}]};
    for(let i=0;i<count;i++) assert.equal(g._spawnHeavy(),true);
    assert.equal(g._spawnHeavy(),false);assert.equal(g.heavies.length,count);
    assert.equal(new Set(g.heavies.map(h=>h.id)).size,count);
    assert.equal(new Set(g.heavies.map(h=>h.x)).size,count);
    g.heavies[0].active=false;g.heavies[0].dead=true;const id=g.heavies[0].id;
    assert.equal(g._spawnHeavy(),true);assert.equal(g.heavies[0].id,id);
    assert.equal(g.heavies.filter(h=>h.active).length,count);
  }
});
test('dead bodies survive ordinary respawn while a self-reviver removes only its own corpse',()=>{
  const g=game();const a={x:100,y:100,angle:1,dead:true,active:false,spawnIndex:0};
  const b={x:150,y:100,angle:2,dead:true,active:false,spawnIndex:1,revivePending:true};
  g.hunters=[a,b];g._syncEnemyCorpses();assert.equal(g.corpseRegistry.length,2);
  g.hunters[0]={x:700,y:700,dead:false,active:true};b.dead=false;b.active=true;
  g._syncEnemyCorpses();assert.equal(g.corpseRegistry.length,1);
  assert.equal(g.corpseRegistry[0].x,100);
  g._updateEnemyEffects(.5);assert.equal(g.state.corpses.length,1);
});
test('corpse registry, fading queue and local display remain bounded during a mass death',()=>{
  const g=game();g.state.corpseLimit=40;
  g.hunters=Array.from({length:300},(_,i)=>({dead:true,active:false,x:i,y:0,angle:0}));
  g._syncEnemyCorpses();g._updateEnemyEffects(0);
  assert.equal(g.corpseRegistry.length,200);
  assert.ok(g.state.corpses.length<=60);
  g._updateEnemyEffects(1.1);
  assert.equal(g.state.corpses.length,40);
  assert.equal(g.state.corpses[0].x,260);
  g.setCorpseLimit(200);g._updateEnemyEffects(0);
  assert.equal(g.state.corpses.length,200);
});
test('corpse and wall-impact events ignore duplicates, old missions and out-of-order revisions',()=>{
  const g=game();g.state.coop={running:true,role:'guest'};
  const add={missionId:'mission-a',revision:1,add:[{id:'c1',kind:'hunter',x:20,y:30,angle:0,width:63}],remove:[]};
  g._applyCorpseDelta(add);g._applyCorpseDelta(add);assert.equal(g.corpseRegistry.length,1);
  g._applyCorpseDelta({...add,revision:2,add:[],remove:['c1']});g._applyCorpseDelta(add);
  assert.equal(g.corpseRegistry.length,0);
  g._applyCorpseDelta({...add,missionId:'old',revision:9});assert.equal(g.corpseRegistry.length,0);
  g._acceptWallImpact({missionId:'mission-a',id:'i1',x:0,y:0});
  g._updateEnemyEffects(.05);const remaining=g.wallShake.remaining;
  g._acceptWallImpact({missionId:'mission-a',id:'i1',x:0,y:0});assert.equal(g.wallShake.remaining,remaining);
  assert.ok(Math.abs(g.state.shakeX*1.56)<=3 && Math.abs(g.state.shakeY*1.56)<=3);
  g._updateEnemyEffects(1);assert.equal(g.state.shakeX,0);assert.equal(g.state.shakeY,0);
});

test('read/save migration persists its marker and local corpse preference without doubling on the next load',()=>{
  saved=JSON.stringify({enemyCountMigrationVersion:0,corpseLimit:40,money:789,
    difficultyProfiles:{easy:{maps:{small:{hunters:100,hunterRespawnCount:3}}}}});
  function load(){
    const g=game();g.player={configureArmory(){},exportArmory:()=>({})};
    for(const name of ['_initializeStorage','_bindBackpackInventories','_migrateStarshipSupplies','_refreshFlashbangStock'])g[name]=()=>{};
    g._save=()=>Game.prototype._save.call(g);g._loadSave();return g;
  }
  const first=load();assert.equal(first.state.difficultyProfiles.easy.maps.small.hunters,200);
  assert.equal(first.state.corpseLimit,40);assert.equal(first.state.money,789);
  assert.equal(JSON.parse(saved).enemyCountMigrationVersion,1);
  const second=load();assert.equal(second.state.difficultyProfiles.easy.maps.small.hunters,200);
  assert.equal(second.state.difficultyProfiles.easy.maps.small.hunterRespawnCount,6);
});

test('a reliable reconnect replaces corpse history even during descent and mission cleanup clears all effects',()=>{
  const g=game();g.state.coop={running:true,role:'guest'};g.state.running=false;
  const body={id:'old',kind:'hunter',x:10,y:20,angle:0,width:63};
  assert.equal(g._applyCorpseDelta({missionId:'mission-a',revision:5,add:[body],remove:[]},true),true);
  assert.equal(g.state.corpses.length,1);
  assert.equal(g._applyCorpseDelta({missionId:'mission-a',revision:8,add:[{...body,id:'new'}],remove:[]},true),true);
  assert.equal(g.state.corpses[0].id,'new');
  g._clearEnemyEffects();assert.equal(g.corpseRegistry.length,0);assert.equal(g.state.corpses.length,0);
  assert.equal(g.state.shakeX,0);assert.equal(g.wallShake,null);
});

test('Hunter melee knockback is collision-clipped across a thin obstacle with its enlarged radius',()=>{
  const g=game();g.state.coop={running:false};g.player={x:0,y:0,radius:10,startMelee:()=>true};
  g.monster={active:false};g._tutorialAction=()=>{};g.audio={playTone(){}};
  g.ui={showToast(){}};
  const hunter={active:true,dead:false,x:40,y:0,radius:22.5,registerHit:()=>({hit:true,dead:false})};
  g.hunters=[hunter];
  g.map={blocked:(x,_y,radius)=>Math.abs(x-65)<radius+2};
  g.melee();
  assert.ok(hunter.x<=40.5,'knockback must stop at the near face, not teleport beyond the obstacle');
});

test('partial legacy profiles with null entries still fall back safely during migration',()=>{
  const g=game();
  const profiles=g._migrateEnemyCounts({difficultyProfiles:{easy:null,medium:{maps:{small:null},finalTerminalSpawnCount:4}}});
  assert.equal(profiles.easy.maps.small.hunters,Config.difficultyPresets.easy.maps.small.hunters);
  assert.equal(profiles.medium.maps.small.hunters,Config.difficultyPresets.medium.maps.small.hunters);
  assert.equal(profiles.medium.finalTerminalSpawnCount,8);
});

test('a bounded corpse batch is sent once rather than resent on every simulation tick',t=>{
  const g=game();g.state.coop={running:true,role:'host'};
  const packets=[];g.coopSession.sendEvent=(type,payload)=>packets.push({type,...payload});
  g.hunters=Array.from({length:200},(_,i)=>({dead:true,active:false,x:i*10,y:100,angle:0}));
  g._syncEnemyCorpses();
  for(let i=0;i<20;i++){g._syncEnemyCorpses();g._updateEnemyEffects(.05);}
  assert.equal(packets.length,1);assert.equal(packets[0].add.length,200);
  const bytes=Buffer.byteLength(JSON.stringify(packets[0]));
  assert.ok(bytes<40000);t.diagnostic(`200-corpse reliable batch: ${bytes} bytes; 20 steady ticks: 0 extra packets`);
});

test('a newer position snapshot cannot suppress the reliable reconnect corpse registry',()=>{
  const g=game();g.state.coop={running:true,role:'guest'};g._lastSnapshotTick=101;
  g._applyCoopSnapshot=()=>assert.fail('older movement state must not be applied');
  g._handleCoopMessage('events',{type:'rejoin-state',snapshot:{tick:100},corpses:{
    missionId:'mission-a',revision:1,add:[{id:'restored',kind:'heavy',x:300,y:400,angle:1,width:112}],remove:[]
  }});
  assert.equal(g.corpseRegistry.length,1);assert.equal(g.state.corpses[0].id,'restored');
  assert.equal(g._lastSnapshotTick,101);
});
