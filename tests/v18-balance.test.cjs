const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s={console,structuredClone,window:{addEventListener(){},matchMedia:()=>({matches:false})}};
for(const file of ['config','inventory','entities','game'])vm.runInNewContext(fs.readFileSync(`js/${file}.js`,'utf8'),s);
const {Config,Game,Monster,Flashbang}=vm.runInNewContext('({Config,Game,Monster,Flashbang})',s);
function game(difficulty='medium',scale='medium'){
 Config.currentScale=scale;const g=Object.create(Game.prototype);g.state={selectedDifficulty:difficulty,coop:{},difficultyProfiles:g._sanitizeDifficultyProfiles(),elapsed:0};
 g.state.hunterSettings=g._buildDifficultySettings(difficulty);g.map={enemyTypes:['monster'],monsterSpawns:[{x:100,y:100}]};return g;
}
test('difficulty profiles drive the requested opening HP/counts and ordinary reinforcement sizes',()=>{
 const rows={easy:[[10,16,24],2,[2,3,4],30,0,40],medium:[[10,16,24],2,[4,6,8],30,1,40],hard:[[20,32,46],3,[6,8,10],20,1,30]};
 for(const [difficulty,[counts,hp,waves,interval,nightmareHp,sleep]]of Object.entries(rows))for(const [i,scale]of ['small','medium','large'].entries()){
  const g=game(difficulty,scale),settings=g._getHunterSettings();assert.equal(settings.hunters,counts[i]);assert.equal(settings.hunterMaxHp,hp);assert.equal(settings.hunterRespawnCount,waves[i]);assert.equal(settings.hunterSpawnInterval,interval);
  g._resetNightmares();if(!nightmareHp){assert.equal(g.nightmares.length,0);continue;}
  assert.equal(g.nightmares[0].hp,nightmareHp);assert.equal(g.nightmares[0].recoveryDuration,sleep);
 }
});
test('Nightmare takes damage amounts, sleeps once at zero and ignores dormant hits',()=>{
 const n=new Monster();n.hp=n.maxHp=5;n.recoveryDuration=20;
 assert.equal(n.registerHit(2).triggeredRecovery,false);assert.equal(n.hp,3);
 assert.equal(n.registerHit(5).triggeredRecovery,true);assert.equal(n.hp,0);assert.equal(n.recoverTimer,20);
 const cycle=n.sleepCycle;assert.equal(n.registerHit(5).triggeredRecovery,false);assert.equal(n.sleepCycle,cycle);
});
test('final terminal keeps ordinary timing; only called medium/hard evacuation switches to ten seconds',()=>{
 for(const [difficulty,ordinary,waiting,called]of [['easy',30,20,30],['medium',30,40,10],['hard',20,60,10]]){
  const g=game(difficulty);assert.equal(typeof g._reinforcementInterval,'function');
  g.state.finalTerminalPressure=true;assert.equal(g._reinforcementInterval(),ordinary);
  g.state.extractionCalled=true;assert.equal(g._reinforcementInterval(),called);assert.equal(g._rescueWaitSeconds(),waiting);
  g.trainingSession={};assert.equal(g._rescueWaitSeconds(),8);
 }
});
test('throw distance caps at 600 while both skill blast ranges grow without changing fuse',()=>{
 const p=new Flashbang('a','host',100,100,1000,100,'grenade');assert.equal(p.remainingDistance,600);
 assert.equal(Config.flashbang.blastRadius,120);assert.equal(Config.flashbang.fuse,1);
});
test('shake doubles nearby amplitude but never changes the aiming conversion',()=>{
 const g=game();g.state.running=true;g.state.missionFxId='m';g.player={x:0,y:0};
 g._acceptWallImpact({id:'impact',missionId:'m',x:0,y:0});assert.equal(g.wallShake.strength,6);assert.equal(g.wallShake.remaining,.24);
 g.player={x:200,y:200,angle:0};g._isPlayerAiming=()=>false;g.ui={frame:{getBoundingClientRect:()=>({left:0,top:0,width:900,height:602})}};g.lastPointerEvent={clientX:600,clientY:260};
 Object.assign(g.state,{cameraZoom:1.56,cameraLookX:0,cameraLookY:0,recoilX:0,recoilY:0,shakeX:0,shakeY:0});g.advanceCamera(0);const first=[g.state.mouseX,g.state.mouseY,g.player.angle];
 g.state.shakeX=6;g.state.shakeY=-3;g.advanceCamera(0);assert.deepEqual([g.state.mouseX,g.state.mouseY,g.player.angle],first);
});

test('wall impacts attenuate, do not stack or replay, and respect reduced motion',()=>{
 const g=game();g.state.running=true;g.state.missionFxId='m';g.player={x:0,y:0};
 g._acceptWallImpact({id:'far',missionId:'m',x:500,y:0});assert.equal(g.wallShake,undefined);
 g._acceptWallImpact({id:'half',missionId:'m',x:250,y:0});assert.equal(g.wallShake.strength,3);
 g._acceptWallImpact({id:'near',missionId:'m',x:0,y:0});assert.equal(g.wallShake.strength,6);
 g._acceptWallImpact({id:'another',missionId:'m',x:250,y:0});assert.equal(g.wallShake.strength,6);
 g.wallShake.remaining=.1;g._acceptWallImpact({id:'near',missionId:'m',x:0,y:0});assert.equal(g.wallShake.remaining,.1);
 s.window.matchMedia=()=>({matches:true});g.wallShake=null;
 g._acceptWallImpact({id:'reduced',missionId:'m',x:0,y:0});assert.equal(g.wallShake,null);
 s.window.matchMedia=()=>({matches:false});
});
