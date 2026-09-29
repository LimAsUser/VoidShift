const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
let saved = null, writes = 0;
const node = () => ({style:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},close(){},open:false});
const nodes = new Map();
const context = vm.createContext({performance:{now:()=>1000},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame(){},
  window:{addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:true})},
  document:{body:node(),getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},querySelectorAll:()=>[]},
  localStorage:{getItem:()=>saved,setItem(_key,value){saved=value;writes++;}}});
for(const file of ['config','rewards','inventory','map','entities','loot','training','game']){
  const p=path.join(__dirname,'../js',file+'.js');if(fs.existsSync(p))vm.runInContext(fs.readFileSync(p,'utf8'),context);
}
const {Game,Player,Monster,BackpackManager,MapManager,Config,TrainingSession,TRAINING_LESSONS}=vm.runInContext(
  '({Game,Player,Monster,BackpackManager,MapManager,Config,TrainingSession:typeof TrainingSession === "undefined"?null:TrainingSession,TRAINING_LESSONS:typeof TRAINING_LESSONS === "undefined"?[]:TRAINING_LESSONS})',context);

function makeGame(owned=false){
  assert.equal(typeof TrainingSession,'function','dedicated training controller is missing');
  const g=Object.create(Game.prototype);Config.currentScale='small';g.map=new MapManager('small',7);
  g.player=new Player();const armory=Player.createDefaultArmory();
  if(owned){armory.ownedWeapons.shotgun=true;armory.loadout.primary='shotgun';armory.weaponAmmo.shotgun={magazine:3,reserve:17};}
  g.player.reset(g.map,armory);g.monster=new Monster();g.monster.reset(g.map);g.hunters=[];g.heavies=[];
  g.state={running:false,transitioning:false,completed:false,elapsed:0,money:6543,armory:g.player.armory,
    inventory:[{id:'real-cargo',name:'real cargo',shape:'1x1',size:1,value:9700,gx:0,gy:0,rot:0}],remoteInventory:[],
    storageItems:[],storageOverflowItems:[],storageCapacity:100,selectedDifficulty:'hard',difficultyProfiles:g._sanitizeDifficultyProfiles(),
    menuMapSeeds:{small:7,medium:8,large:9},fpsCap:'60',corpseLimit:100,keys:{},fireHeld:false,
    coop:{role:null,running:false,connected:false,members:[]}};
  g.state.hunterSettings=g._buildDifficultySettings('hard');g.state.finalTerminalSettings=g._finalTerminalSettings();
  g.backpack=BackpackManager.fromType('field');g.remoteBackpack=BackpackManager.fromType('field');
  g.remotePlayers=new Map();g.coopReviveAssignments=new Map();g.selectedStorageIds=new Set();g.selectedPackIds=new Set();
  g._bindBackpackInventories();g._initializeStorage();
  g.loot=new (vm.runInContext('LootController',context))(g);
  const ui={fullMapCanvas:null,frame:null};g.calls=[];
  g.ui=new Proxy(ui,{get(o,key){return key in o?o[key]:(...args)=>g.calls.push([key,...args]);}});
  g.audio={ensureAudio(){},preloadSound(){},beginMissionAudio(){},stopMissionAudio(){},playTone(){},playQTEKeyBeep(){},playQTESuccess(){},context:null,update(){}};
  for(const name of ['handleResize','render','updateDifficultyUI','updateHunterSettingsUI','updateLoadoutUI','updateStorageUI',
    'updateMoneyUI','updateCoopUI','updateInventoryUI','updateAmmoDepotUI','updateTutorialAvailability'])g[name]=()=>{};
  g._save();return g;
}
function launch(g){g.startTutorial();g._completeDescentTransition();return g.trainingSession;}
function takeTrainingPart(g){const box=g.map.containers[0];Object.assign(g.player,{x:box.x-40,y:box.y});return g.loot.handleRequest({missionId:g.state.missionFxId,requestId:++g.loot.requestSequence,containerId:box.id,itemId:'training-part',action:'take'},'host').accepted;}

test('training uses a shared-grid crate and medkit lesson without rewards or permanent supplies',()=>{
  const g=makeGame();g.loot=vm.runInContext('LootController',context) && new (vm.runInContext('LootController',context))(g);
  const session=launch(g), before=saved;
  assert.ok(Array.isArray(g.map.containers)&&g.map.containers.length>0,'training crate exists');assert.equal(g.map.scrap.length,0);
  session.prepare(TRAINING_LESSONS.findIndex(step=>step.id==='pickup'));g.beginTutorialPractice();
  const box=g.map.containers[0];Object.assign(g.player,{x:box.x-40,y:box.y});
  assert.equal(g.loot.handleRequest({missionId:g.state.missionFxId,requestId:1,containerId:box.id,itemId:'training-part',action:'take'},'host').accepted,true);
  assert.equal(session.progress.pickup,true);
  const index=TRAINING_LESSONS.findIndex(step=>step.id==='medkit');assert.ok(index>=0);
  session.prepare(index);g.beginTutorialPractice();assert.equal(g.player.health,60);assert.equal(g.useQuickItem('health-40'),true);
  assert.equal(g.player.health,60);g.state.elapsed+=2;g._updateSupplyUses();assert.equal(g.player.health,100);
  session.prepare(TRAINING_LESSONS.findIndex(step=>step.id==='hunter'));assert.equal(session.target.hp,2);
  session.prepare(TRAINING_LESSONS.findIndex(step=>step.id==='heavy-wall'));assert.equal(session.target.hp,5);
  session.exit();assert.equal(saved,before);
});

test('training isolates assets before descent/save and restores original references for pistol-only and owned saves',()=>{
  for(const owned of [false,true]){
    const g=makeGame(owned), original={state:g.state,player:g.player,map:g.map,backpack:g.backpack,storage:g.storageBackpack};
    const before=saved, count=writes;g.startTutorial();
    assert.ok(g.trainingSession);assert.equal(g.state.transitioning,true);g._save();assert.equal(saved,before);assert.equal(writes,count);
    assert.equal(g.player.armory.ownedWeapons.smg,true);assert.equal(original.player.armory.ownedWeapons.smg,false);
    assert.equal(g.state.selectedDifficulty,'easy');g._completeDescentTransition();
    assert.equal(g.map.isTraining,true);assert.equal(g.map.functionalRooms.length,6);assert.equal(g.map.terminals.length,2);
    assert.equal(g.state.tutorial.steps.length,TRAINING_LESSONS.length);
    g.state.money=0;g.player.armory.weaponAmmo.smg.reserve=0;g.state.inventory.length=0;g._save();
    g.exitTraining();assert.equal(g.state,original.state);assert.equal(g.player,original.player);assert.equal(g.map,original.map);
    assert.equal(g.backpack,original.backpack);assert.equal(g.storageBackpack,original.storage);assert.equal(g.state.money,6543);
    assert.equal(saved,before);assert.equal(g.trainingSession,null);assert.equal(g.state.menuMapSeeds.small,7);
  }
});

test('movement needs the marker and sprint, paused actions do not advance, and retry preserves earlier lessons',()=>{
  const g=makeGame(), session=launch(g);
  g._tutorialAction('sprint');session.tick(0);assert.equal(g.state.tutorial.step,0);
  g.beginTutorialPractice();g._tutorialAction('move');g._tutorialAction('sprint');session.tick(0);
  assert.equal(g.state.tutorial.step,0);
  Object.assign(g.player,g.map.trainingPoints.move);session.tick(0);
  assert.equal(g.state.tutorial.step,1);assert.equal(g.state.tutorial.paused,true);
  g.beginTutorialPractice();g.player.health=0;g.finish(false);
  assert.equal(g.state.tutorial.step,1);assert.equal(g.player.health,100);assert.equal(g.state.tutorial.paused,true);
  assert.ok(g.trainingSession);assert.equal(g.state.completed,false);
});

test('normal spawning, rewards, and enemy wakeup cannot leak into a training run',()=>{
  const g=makeGame(), session=launch(g);const before=saved;
  assert.equal(g._createHunters().length,0);assert.equal(g._spawnHeavy(),false);assert.equal(g._spawnNewHunters(100),0);
  g.activateMonster('not a training cue');assert.equal(g.monster.active,false);
  g.skipTutorial();assert.equal(g.trainingSession,null);assert.equal(saved,before);
  assert.equal(g.state.running,false);
});

test('wrong targets and empty melee/skill presses do not pass the matching exercise',()=>{
  const g=makeGame(), session=launch(g);
  session.prepare(TRAINING_LESSONS.findIndex(step=>step.id==='melee'));g.beginTutorialPractice();
  g._tutorialAction('melee');session.tick(0);assert.equal(session.lesson.id,'melee');
  session.action('melee-hit',{target:{},hit:{hit:true}});session.tick(0);assert.equal(session.lesson.id,'melee');
  session.action('melee-hit',{target:session.target,hit:{hit:true}});session.tick(0);
  assert.equal(session.lesson.id,'roll');assert.equal(g.state.tutorial.paused,true);
});

test('actual target pickup advances, oxygen use consumes only loaned bottles, and a discarded target can be retried',()=>{
  const g=makeGame(), session=launch(g), before=saved;
  session.prepare(TRAINING_LESSONS.findIndex(step=>step.id==='pickup'));g.beginTutorialPractice();
  assert.equal(takeTrainingPart(g),true);session.tick(0);assert.equal(session.lesson.id,'backpack');
  session.prepare(TRAINING_LESSONS.findIndex(step=>step.id==='oxygen'));g.beginTutorialPractice();
  assert.equal(g.player.oxygen,50);const bottle=g.backpack.items.find(item=>item.effect==='oxygen-50');
  assert.equal(g._useOxygenBottle(g.player,bottle.id),true);assert.equal(g.player.oxygen,50);
  g.state.elapsed+=2;g._updateSupplyUses();assert.equal(g.player.oxygen,100);session.tick(0);
  assert.equal(session.lesson.id,'medkit');assert.equal(saved,before);g.exitTraining();assert.equal(saved,before);
});

test('all lessons run through actual action results, three enemy mechanics, both QTEs and eight-second extraction',()=>{
  const g=makeGame(), before=saved, originalMap=g.map, session=launch(g);
  const practice=id=>{assert.equal(session.lesson.id,id);assert.equal(g.state.tutorial.paused,true);g.beginTutorialPractice();};
  const aimAndShoot=()=>{g.state.stabilized=true;g.player.angle=Math.atan2(session.target.y-g.player.y,session.target.x-g.player.x);g.shoot();};
  practice('move');g.state.keys={d:true,shift:true};g.update(1);
  practice('flashlight');g.player.flashlight=!g.player.flashlight;g._tutorialAction('flashlight');session.tick(0);
  practice('door');const door=g.map.trainingDoor;Object.assign(g.player,{x:(door.p1.x+door.p2.x)/2-door.normal.x*24,y:(door.p1.y+door.p2.y)/2-door.normal.y*24});
  g.interact();g.map.advanceDoorAnimations(.35,[g.player]);session.tick(0);
  practice('pickup');const box=g.map.containers[0];Object.assign(g.player,{x:box.x-40,y:box.y});
  g.loot.handleRequest({missionId:g.state.missionFxId,requestId:1,containerId:box.id,itemId:'training-part',action:'take'},'host');session.tick(0);
  practice('backpack');g.toggleInventory(true);
  g._itemDrag={kind:'inventory',manager:g.backpack,item:g.backpack.getItem('training-part'),rot:0,moved:true,
    pointerX:226,pointerY:130,metrics:{left:0,top:0,stepX:32,stepY:32},grabX:0,grabY:0,tile:node()};
  g._handleItemDragEnd({pointerId:1});assert.equal(g.backpack.getItem('training-part').gx,7);
  g.toggleInventory(false);session.tick(0);
  practice('oxygen');assert.equal(g.useQuickItem(),true);g.state.elapsed+=2;g._updateSupplyUses();session.tick(0);
  practice('medkit');assert.equal(g.useQuickItem('health-40'),true);g.state.elapsed+=2;g._updateSupplyUses();session.tick(0);
  practice('shooting');Object.assign(g.player,g.map.trainingPoints.firing);session.tick(0);aimAndShoot();assert.ok(session.progress['aimed-hit']);
  assert.equal(g.player.reload(g.audio),true);g.update(4.1);
  practice('slots');g.switchWeaponSlot('sidearm');g.switchWeaponSlot('primary');session.tick(0);
  practice('melee');Object.assign(g.player,g.map.trainingPoints.firing);session.tick(0);g.player.x=session.target.x-40;g.player.y=session.target.y;
  assert.equal(g.melee(),true);session.tick(0);
  practice('roll');assert.equal(g.roll(g.player,-1,0),true);g.update(.35);
  practice('flash');Object.assign(g.player,g.map.trainingPoints.firing);session.tick(0);
  assert.equal(g.useSkill(g.player,session.target.x,session.target.y),true);
  for(let i=0;i<40 && session.lesson.id==='flash';i++)g.update(.1);
  practice('hunter');session.tick(0);aimAndShoot();g.player.shootCooldown=0;aimAndShoot();session.tick(0);
  practice('monster-down');Object.assign(g.player,g.map.trainingPoints.monsterEntry);session.tick(0);
  for(let i=0;i<5;i++){aimAndShoot();g.update(.11);}
  practice('monster-wake');assert.ok(session.target.recoverTimer>39);
  for(let i=0;i<410 && session.lesson.id==='monster-wake';i++)g.update(.1);
  practice('heavy-wall');Object.assign(g.player,g.map.trainingPoints.heavyEntry);session.tick(0);
  for(let i=0;i<120 && session.lesson.id==='heavy-wall';i++){
    if(session.target.phase==='windup' && session.target.phaseTimer<1)g.state.keys={w:true};
    if(session.target.phase==='charge')g.state.keys={};
    g.update(.1);
  }
  practice('heavy-kill');assert.equal(session.target.phase,'stunned');assert.equal(session.target.hp,5);
  for(let i=0;i<20 && session.lesson.id==='heavy-kill';i++){aimAndShoot();g.update(.11);}
  practice('map');g.renderer={drawFullMap(){}};g.ui.fullMapCanvas={classList:{add(){},remove(){}},getBoundingClientRect:()=>({width:800,height:500,left:0,top:0})};
  g.toggleFullMap(true);g.setFullMapZoomAt(1.1);g.toggleFullMap(false);session.tick(0);
  for(const id of ['terminal-1','terminal-2']){
    practice(id);
    if(id==='terminal-2'){
      g.player.health=0;g.finish(false);assert.equal(g.map.terminals[0].solved,true);g.beginTutorialPractice();
    }
    const terminal=g.map.terminals.find(t=>t.id===session.lesson.terminal);Object.assign(g.player,{x:terminal.x,y:terminal.y-30});
    g.interact();assert.ok(g.state.activeQte);
    for(const key of terminal.sequence)g.handleQTEInput(key.toLowerCase());
    session.tick(0);
  }
  practice('rescue');assert.equal(g.hunters.length,0);assert.equal(g.heavies.length,0);assert.equal(g.monster.active,false);
  Object.assign(g.player,g.map.exitExtractionPoint);assert.equal(g.callExtraction(),true);assert.equal(g.state.rescueRemaining,8);
  g.update(7.9);assert.ok(g.trainingSession);g.update(.11);
  assert.equal(g.trainingSession,null);assert.equal(saved,before);assert.equal(g.map,originalMap);
  assert.equal(g.calls.find(call=>call[0]==='showTrainingComplete')[1].completed,TRAINING_LESSONS.length);
  assert.equal(g.state.selectedDifficulty,'hard');
  assert.equal(g._createHunters().length,g.map.enemyTypes.includes('hunter')?g.state.hunterSettings.small.hunters:0,
    'normal encounter selection and configured counts are restored after exit');
});

test('retry restores missing cargo/ammo and oxygen failure even if guidance state was hidden',()=>{
  const g=makeGame(), session=launch(g), before=saved;
  session.prepare(TRAINING_LESSONS.findIndex(step=>step.id==='oxygen'));g.beginTutorialPractice();
  const count=g.backpack.items.length;g.backpack.items.length=0;g.player.armory.weaponAmmo.smg.reserve=0;
  g.player.oxygen=0;session.tick(0);
  assert.equal(g.backpack.items.length,count);assert.equal(g.player.oxygen,50);assert.equal(g.player.reserveAmmo,240);
  assert.equal(session.lesson.id,'oxygen');assert.equal(g.state.tutorial.paused,true);
  g.state.tutorial=null;g.state.money=999999;g._save();assert.equal(saved,before);
  g.abandonMission();assert.equal(g.trainingSession,null);assert.equal(saved,before);
  assert.equal(JSON.parse(saved).money,6543,'a refresh can only reload the unchanged real save');
});

test('training restores item allocation and enemy spawn counters before the next real recovery',()=>{
  const g=makeGame();g._storeRecoveredItems([{name:'first',shape:'1x1',value:100}]);
  const next=g.storageNextId;g.nextHunterSpawnIndex=23;
  launch(g);g.exitTraining();assert.equal(g.storageNextId,next);assert.equal(g.nextHunterSpawnIndex,23);
  g._storeRecoveredItems([{name:'second',shape:'1x1',value:100}]);
  assert.equal(new Set(g.storageBackpack.items.map(item=>String(item.id))).size,2);
  assert.equal(new Set(g.storageBackpack.items.map(item=>`${item.gx}:${item.gy}`)).size,2);
});

test('early pickup and exhausted borrowed consumables cannot create an impossible lesson checkpoint',()=>{
  const g=makeGame(), session=launch(g);g.beginTutorialPractice();
  assert.equal(takeTrainingPart(g),true);
  session.prepare(TRAINING_LESSONS.findIndex(step=>step.id==='pickup'));g.retryTrainingLesson();g.beginTutorialPractice();
  assert.equal(takeTrainingPart(g),true,'pickup prerequisite must be restored, not checkpointed as already found');
  g.backpack.items.length=0;
  session.prepare(TRAINING_LESSONS.findIndex(step=>step.id==='backpack'));
  assert.ok(g.backpack.items.length,'empty inventory still has an item to rearrange');
  g.backpack.items.length=0;
  session.prepare(TRAINING_LESSONS.findIndex(step=>step.id==='oxygen'));g.retryTrainingLesson();g.beginTutorialPractice();
  assert.equal(g.useQuickItem(),true,'lesson preparation must lend its missing bottle before checkpointing');
});

test('terminal mistakes regenerate input safely, never spawn enemies, and permit a successful retry',()=>{
  const g=makeGame(), session=launch(g), before=saved;
  g.audio.playLoudAlarmSound=()=>{};
  session.prepare(TRAINING_LESSONS.findIndex(step=>step.id==='terminal-1'));g.beginTutorialPractice();
  const terminal=g.map.terminals[0];Object.assign(g.player,{x:terminal.x,y:terminal.y-30});g.interact();
  for(let i=0;i<3;i++){
    const wrong=['w','a','s','d'].find(key=>key!==g.state.activeQte.sequence[0].toLowerCase());
    g.handleQTEInput(wrong);
    assert.equal(g.monster.active,false);assert.equal(g.hunters.length,0);assert.equal(g.heavies.length,0);
    if(i<2){assert.equal(g.state.activeQte.sequence.length,5);assert.equal(g.state.activeQte.failCount,i+1);}
  }
  assert.equal(terminal.solved,false);g.retryTrainingLesson();g.beginTutorialPractice();
  Object.assign(g.player,{x:terminal.x,y:terminal.y-30});g.interact();assert.ok(g.state.activeQte);
  for(const key of g.state.activeQte.sequence)g.handleQTEInput(key.toLowerCase());
  session.tick(0);assert.equal(session.lesson.id,'terminal-2');assert.equal(saved,before);
  const first=MapManager.createTraining(),second=MapManager.createTraining();
  assert.deepEqual(first.generateQTESequence(12),second.generateQTESequence(12));
});
