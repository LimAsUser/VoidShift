const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s={console,structuredClone,performance,window:{addEventListener(){},matchMedia:()=>({matches:false})}};
for(const f of ['config','inventory','entities','corpses','game'])vm.runInNewContext(fs.readFileSync(`js/${f}.js`,'utf8'),s);
const {Config,Game,Player,Hunter,Heavy,CorpseEffects}=vm.runInNewContext('({Config,Game,Player,Hunter,Heavy,CorpseEffects})',s);
function fixture(){const g=Object.create(Game.prototype);g.state={running:true,elapsed:1,missionFxId:'m',selectedDifficulty:'medium',corpseLimit:40,coop:{playerId:'host'},hideInteractionHints:false};
 g.player=new Player();g.player.x=g.player.y=100;g.remotePlayers=new Map();g.hunters=[];g.heavies=[];g.nightmares=[];g.map={blocked:()=>false,doors:[],walls:[]};g.ui={showToast(){},log(){},updateCoopRevivePrompt(text){g.prompt=text;}};
 g.audio={playMonsterHit(...args){g.sound=args;}};g.coopSession={sendEvent:()=>true,peers:new Map()};g._clearEnemyEffects();return g;}
test('only true Hunter/Heavy deaths produce fragments, reviving corpses remain intact, budgets remain bounded',()=>{
 const g=fixture(),a=new Hunter(0,2,()=>1),b=new Hunter(1,2,()=>1),h=new Heavy(10);Object.assign(a,{active:true,x:100,y:100});Object.assign(b,{active:true,x:130,y:100,trait:'reviver'});Object.assign(h,{active:true,x:200,y:100,phase:'stunned'});
 a.registerHit(2);b.registerHit(2);h.registerHit(10);g.hunters=[a,b];g.heavies=[h];g._syncEnemyCorpses();
 assert.equal(g.corpseRegistry.filter(c=>c.fragments).length,2);assert.equal(g.corpseRegistry.find(c=>c.intact).fragments,undefined);
 g.hunters=Array.from({length:220},(_,i)=>({dead:true,x:i+100,y:300,angle:0,spawnIndex:i+5}));g._syncEnemyCorpses();
 assert.equal(g.corpseRegistry.length,200);assert.ok(g.state.corpses.length<=60);assert.ok(g.state.corpses.every(c=>!c.fragments||c.fragments.length<=8));
});
test('host nudge physics sleeps and moving-only payloads remain small without touching player collision',()=>{
 const g=fixture();g.state.coop={role:'host',running:true,playerId:'host'};const peer=new Player();g.remotePlayers.set('p',{id:'p',slot:2,player:peer,online:true,inventory:[]});const packets=[];
 g.coopSession.sendEvent=(type,payload)=>{packets.push({type,...payload});return true;};
 g.hunters=[{dead:true,x:110,y:100,angle:0,spawnIndex:0}];g._syncEnemyCorpses();
 for(let i=0;i<90;i++)g._updateCorpsePhysics(.025);assert.equal(g.corpseActive.size,0);const count=packets.length;
 for(let i=0;i<10;i++)g._updateCorpsePhysics(.05);assert.equal(packets.length,count);
 const part=g.corpseRegistry[0].fragments[0];g.player.x=part.x;g.player.y=part.y;const position=[g.player.x,g.player.y];g._updateCorpsePhysics(.05);
 assert.deepEqual([g.player.x,g.player.y],position);assert.ok(g.corpseActive.size>0);
 assert.ok(packets.filter(p=>p.type==='corpse-motion').every(p=>Buffer.byteLength(JSON.stringify(p))<32000));
});
test('monster hit audio events play once, identify local versus remote victims and reject another mission',()=>{
 const g=fixture();const event={missionId:'m',seq:1,victimId:'host',x:100,y:100};
 assert.equal(g._acceptMonsterContact(event),true);assert.equal(g.sound[4],true);assert.equal(g._acceptMonsterContact(event),false);
 assert.equal(g._acceptMonsterContact({...event,seq:2,victimId:'peer'}),true);assert.equal(g.sound[4],false);
 assert.equal(g._acceptMonsterContact({...event,seq:3,missionId:'old'}),false);
});
test('hidden interaction hints keep active revive progress and training guidance',()=>{
 const g=fixture();g.state.hideInteractionHints=true;g.loot={nearest:()=>({fixed:true})};g._updateCoopRevivePrompt();assert.equal(g.prompt,'');
 g.trainingSession={};g._updateCoopRevivePrompt();assert.match(g.prompt,/按 E/);g.trainingSession=null;
 const mate=new Player();mate.x=100;mate.y=110;mate.downed=true;mate.reviveProgress=1;g.state.coop={role:'host',running:true,playerId:'host'};g.remotePlayers.set('p',{id:'p',slot:2,online:true,player:mate});g.coopReviveAssignments=new Map([['p','host']]);
 g._updateCoopRevivePrompt();assert.match(g.prompt,/救援中/);assert.doesNotMatch(g.prompt,/按 E/);
});
test('migration changes only balance fields once and a guest uses host access without granting local ownership',()=>{
 const g=fixture(),saved={difficultyProfiles:g._sanitizeDifficultyProfiles(),playerFeedbackMigrationVersion:1,balanceVersion:17,money:1234};saved.difficultyProfiles.medium.maps.medium.hunters=1;
 const next=g._migrateV18Profiles(saved);assert.equal(next.medium.maps.medium.hunters,18);assert.equal(saved.money,1234);next.medium.maps.medium.hunters=7;
 assert.equal(g._migrateV18Profiles({difficultyProfiles:next,balanceVersion:18,playerFeedbackMigrationVersion:1}).medium.maps.medium.hunters,7);
 g.state.advancedUnlocked=false;assert.equal(g.canSelectMission('large','hard'),false);g.state.coop={role:'guest',hostAdvancedUnlocked:true};assert.equal(g.canSelectMission('large','hard',true),true);assert.equal(g.state.advancedUnlocked,false);
 g.state.coop.role=null;assert.equal(g.canSelectMission('large','hard',true),false);
});
test('offline lobby transitions restore a locked guests own legal choice after host large/hard play',()=>{
 const g=fixture();g.state.running=false;g.state.advancedUnlocked=false;g.state.selectedDifficulty='hard';g.state.personalDifficulty='medium';g.state.personalScale='small';g.state.coop={role:null,members:[]};Config.currentScale='large';
 g.state.difficultyProfiles=g._sanitizeDifficultyProfiles();g.ui.updateCoopLobby=()=>{};
 g.updateDifficultyUI=g.updateHunterSettingsUI=g.updateTutorialAvailability=g.updateLoadoutUI=g.updateAmmoDepotUI=()=>{};
 g.updateCoopUI();assert.equal(g.state.selectedDifficulty,'medium');assert.equal(Config.currentScale,'small');assert.equal(g.canSelectMission(),true);
});

test('slow or reconnecting peers receive the latest settled pose without replaying a death burst',()=>{
 const g=fixture(),packets=[],peer=new Player();g.state.coop={role:'host',running:true,playerId:'host'};
 g.remotePlayers.set('p',{id:'p',online:true,equipmentSyncing:true,player:peer});
 const channel={bufferedAmount:0};g.coopSession.peers.set('p',{eventChannel:channel});
 g.coopSession.sendEvent=(type,payload)=>{packets.push({type,...structuredClone(payload)});return true;};
 g.hunters=[{dead:true,x:110,y:100,angle:0,spawnIndex:0}];g._syncEnemyCorpses();packets.length=0;
 for(let i=0;i<90;i++)g._updateCorpsePhysics(.025);
 assert.equal(packets.length,0);assert.equal(g.corpsePosePending.get('p').size,1);
 g.remotePlayers.get('p').equipmentSyncing=false;channel.bufferedAmount=65000;g._updateCorpsePhysics(.05);assert.equal(packets.length,0);
 channel.bufferedAmount=0;g._updateCorpsePhysics(.05);assert.equal(packets.length,1);
 const pose=packets[0].poses[0];assert.equal(pose.version,g.corpseRegistry[0].motionVersion);assert.ok(pose.parts.every(p=>p[3]===1));
 const guest=fixture();guest.state.coop={role:'guest',running:true};
 assert.equal(guest._applyCorpseDelta({missionId:'m',revision:g.corpseRevision,add:structuredClone(g.corpseRegistry),remove:[]},true),true);
 assert.equal(guest.corpseRegistry[0].suppressBurst,true);
 assert.deepEqual(JSON.parse(JSON.stringify(guest.corpseRegistry[0].fragments)),JSON.parse(JSON.stringify(g.corpseRegistry[0].fragments)));
});
