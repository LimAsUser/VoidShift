const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
function fixture(difficulty='medium'){
 const storage=new Map();let lock=Promise.resolve();const ctx=vm.createContext({structuredClone,Date,Map,Set,Promise,crypto:globalThis.crypto,setTimeout,
  window:{addEventListener(){},switchTab(){}},document:{body:{classList:{remove(){}}},getElementById:()=>null},performance:{now:()=>1000},clearTimeout,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},navigator:{locks:{request:(_key,fn)=>{const r=lock.then(fn);lock=r.catch(()=>{});return r;}}}});
 for(const f of ['config','inventory','rewards','reward-client','entities','loot','game'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f+'.js'),'utf8'),ctx);
 const {Game,Player,Hunter,Monster,Heavy,DefeatLedger,BackpackManager,LootController}=vm.runInContext('({Game,Player,Hunter,Monster,Heavy,DefeatLedger,BackpackManager,LootController})',ctx);
 const g=Object.create(Game.prototype);g.player=new Player();g.state={running:true,completed:false,missionFxId:'test-mission',selectedDifficulty:difficulty,money:1000,rewardCreditsTotal:0,
  inventory:[],storageItems:[],storageOverflowItems:[],storageCapacity:100,coop:{role:null,running:false,playerId:'host',members:[]},
  bulletTraces:[],muzzleFlashes:[],impactParticles:[],elapsed:12,loot:1,lootValue:500};
 g.state.difficultyProfiles=g._sanitizeDifficultyProfiles();g.state.hunterSettings=g._buildDifficultySettings(difficulty);
 g.state.armory=g.player.armory;g.backpack=new BackpackManager(8,5);g.remoteBackpack=new BackpackManager(8,5);g.storageBackpack=new BackpackManager(10,10);
 g.map={containers:[],scrap:[],terminals:[],blocked:()=>false};g.remotePlayers=new Map();g.remoteQtes=new Map();g.heavies=[];g.hunters=[];g.monster=new Monster();
 g.ui=new Proxy({},{get:(_o,k)=>['settingsModal','abandonConfirmDialog'].includes(k)?null:()=>{}});g.audio={stopMissionAudio(){}};
 for(const name of ['handleResize','updateStorageUI','_rollNextMenuMaps','updateDifficultyUI','updateHunterSettingsUI','updateLoadoutUI','updateCoopUI','updateTutorialAvailability','updateMoneyUI','updateInventoryUI'])g[name]=()=>{};
 g.loot=new LootController(g);g.rewards=new (vm.runInContext('MissionRewardsClient',ctx))((receipt,result)=>g._onRewardReceipt(receipt,result));g.coopSession={sendEvent:()=>true};
 g.defeatLedger=new DefeatLedger(g.state.missionFxId,['host','p2']);g.defeatNames={host:'房主',p2:'队员2'};
 g.backpack.items=[{id:'cargo',value:500,shape:'1x1',gx:0,gy:0}];g.state.inventory=g.backpack.items;
 return{g,Player,Hunter,Monster,Heavy,storage,settled:async()=>{await new Promise(setImmediate);await lock;}};
}
test('real projectile attribution awards only final Hunter death and each Nightmare sleep cycle',()=>{
 const {g,Player,Hunter}=fixture();const remote=new Player();g.remotePlayers.set('p2',{id:'p2',player:remote,online:true});
 g.state.coop.running=true;g.state.coop.role='host';g.state.coop.members=[{id:'p2',slot:2,connected:true}];
 const hunter=new Hunter(0,2,()=>1);hunter.active=true;hunter.lifeId='hunter-life1';g.hunters=[hunter];
 g._applyProjectileHit(hunter,g.player,0);g._applyProjectileHit(hunter,remote,0);
 assert.equal(g.defeatLedger.players.get('host').counts.hunter,0);assert.equal(g.defeatLedger.players.get('p2').counts.hunter,1);
 const nightmare=g.monster;nightmare.id='n1';nightmare.active=true;g._applyProjectileHit(nightmare,g.player,0);g._applyProjectileHit(nightmare,g.player,0);
 nightmare.recoverTimer=0;g._applyProjectileHit(nightmare,g.player,0);assert.equal(g.defeatLedger.players.get('host').counts.monster,2);
});
test('solo finish credits defeat rewards once, never converts retained loot to cash',async()=>{
 const f=fixture(),g=f.g;g.defeatLedger.record('hunter','h','host');g.defeatLedger.record('monster','n','host');g.defeatLedger.record('heavy','hv','host');
 g.finish(true);await f.settled();assert.equal(g.state.money,1280);assert.equal(g.backpack.items.length,1);
 assert.equal(JSON.parse(f.storage.get('voidshift_save')).money,1280);g.finish(true);await f.settled();assert.equal(g.state.money,1280);
 assert.equal(g.state.settlement.rewardStatus,'已到账');
});
test('failure pays half and clears carried loot without changing the existing ammo-loss calculation',async()=>{
 const f=fixture(),g=f.g;g.defeatLedger.record('heavy','h','host');g.finish(false);await f.settled();
 assert.equal(g.state.money,1100);assert.equal(g.backpack.items.length,0);
 assert.equal(g.player.armory.weaponAmmo.pistol.magazine+g.player.armory.weaponAmmo.pistol.reserve,63);
});
test('replayed Guest finish cannot overwrite a new backpack or apply an armory twice',()=>{
 const {g,Player}=fixture();g.state.coop.role='guest';g.state.coop.playerId='p2';let finishes=0;g.finish=()=>{finishes++;};
 const message={missionId:'test-mission',resultId:'result1',success:true,items:[{id:'loot',shape:'1x1'}],playerArmory:Player.createDefaultArmory(),rewards:[]};
 g._finishGuestCoop(message);g.state.inventory=[{id:'new-item'}];g._finishGuestCoop(message);
 assert.equal(finishes,1);assert.equal(g.state.inventory[0].id,'new-item');
});

test('async mission registration revalidates live readiness and loadout before starting',async()=>{
 for(const change of ['readiness','loadout']){
  const {g}=fixture();g.state.running=false;g.state.coop={role:'host',running:false,code:'ABC234',localReady:true,members:[{id:'p2',slot:2,connected:true,ready:true}]};
  g.coopSession.roomCode='ABC234';g.coopSession.hostToken='token';g.coopSession.peers=new Map([['p2',{connected:true,eventChannel:{readyState:'open'}}]]);
  let release;g.rewards={register:()=>new Promise(resolve=>release=resolve),queueReport:async()=>{},flush:async()=>{}};g._confirmRewardAccess=async()=>{};
  let starts=0;g._beginCoopMission=()=>{starts++;return true;};const starting=g.startCoopMission();
  if(change==='readiness'){g.state.coop.localReady=false;g.state.coop.members=[{id:'p2',slot:2,connected:true,ready:false}];}
  else g.player.armory.loadout.primary='smg';
  release({missionId:'pending',access:{p2:{}}});assert.equal(await starting,false,change);assert.equal(starts,0);
 }
});

test('mission identifiers are random across clients even with the same clock and page counter',()=>{
 const {g}=fixture();assert.equal(typeof g._newMissionId,'function');
 const ids=new Set(Array.from({length:32},()=>g._newMissionId('mission')));assert.equal(ids.size,32);
 for(const id of ids)assert.match(id,/^mission-[a-f0-9]{32}$/);
});

test('final terminal log uses the actual difficulty and frozen crew Heavy cap',()=>{
 const {g}=fixture('hard');g.state.coop={role:'host',running:true,difficultyMultiplier:2,members:[]};g.map.terminals=[{solved:true}];
 g._spawnNewHunters=()=>0;g._spawnHeavy=()=>false;let log='';g.ui={showToast(){},updateExtractionProgress(){},log:message=>log=message};
 assert.equal(g._activateFinalTerminalPressure(),true);assert.match(log,/Heavy 上限为 6 只/);
});

test('four-player hard snapshots retain all ten Heavies and eight Nightmares',()=>{
 const {g}=fixture('hard');g.state.coop={role:'guest',running:true,playerId:'p2',members:[]};
 Object.assign(g.map,{worldRooms:[],doors:[],layoutSignature:()=> 'same'});
 const heavies=Array.from({length:10},(_,index)=>({id:`heavy-${index}`,x:500+index*100,y:500,angle:0,radius:44,hp:10,maxHp:10,active:true,dead:false,phase:'pursuit'}));
 const nightmares=Array.from({length:8},(_,index)=>({id:`nightmare-${index}`,x:1000+index*60,y:300,angle:0,active:true,recoverTimer:0}));
 assert.equal(g._applyCoopSnapshot({tick:1,mapSignature:'same',players:[{id:'p2',slot:2,state:{x:0,y:0,angle:0},inventory:[]}],heavies,nightmares,hunters:[]}),true);
 assert.equal(g.heavies.length,10);assert.equal(g.nightmares.length,8);
});
