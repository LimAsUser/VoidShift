const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const ctx=vm.createContext({window:{addEventListener(){}},structuredClone});for(const file of ['config','inventory','entities','game'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),ctx);
const {Config,Game,Monster}=vm.runInContext('({Config,Game,Monster})',ctx);
test('team size scales counts only and preserves HP, intervals and source profiles',()=>{
  const g=Object.create(Game.prototype),base={small:{hunters:10,hunterMaxHp:2,hunterRespawnCount:2,hunterSpawnInterval:30}},final={spawnCount:10,spawnInterval:30};
  for(const [players,count,wave] of [[1,10,2],[2,10,2],[3,15,3],[4,20,4]]){
    const r=g._scaleCoopMissionSettings(base,final,players,'small');assert.equal(r.hunterSettings.small.hunters,count);
    assert.equal(r.hunterSettings.small.hunterRespawnCount,wave);assert.equal(r.hunterSettings.small.hunterMaxHp,2);
    assert.equal(r.hunterSettings.small.hunterSpawnInterval,30);assert.equal(r.finalTerminalSettings.spawnInterval,30);
  }
  assert.equal(base.small.hunters,10);
});
test('V18 migration updates specified balance fields once without changing the supplied save object',()=>{
  const g=Object.create(Game.prototype);g.state={};
  assert.equal(typeof g._migrateV18Profiles,'function');
  const saved={easy:{maps:{small:{hunters:77,hunterMaxHp:33,hunterRespawnCount:7,hunterSpawnInterval:42}},finalTerminalSpawnCount:31,finalTerminalSpawnInterval:51}};
  const profiles=g._migrateV18Profiles({difficultyProfiles:saved,enemyCountMigrationVersion:1});
  assert.equal(profiles.easy.maps.small.hunters,10);assert.equal(profiles.easy.maps.small.hunterMaxHp,2);
  assert.equal(profiles.easy.maps.small.hunterRespawnCount,2);assert.equal(profiles.easy.maps.small.hunterSpawnInterval,30);
  assert.equal(saved.easy.maps.small.hunterRespawnCount,7);assert.equal(saved.easy.finalTerminalSpawnCount,31);
  assert.equal(profiles.hard.maps.large.hunters,50);assert.equal(profiles.medium.maps.medium.hunters,18);
  profiles.easy.maps.small.hunters=11;
  assert.equal(g._migrateV18Profiles({difficultyProfiles:profiles,balanceVersion:18,enemyCountMigrationVersion:1,playerFeedbackMigrationVersion:1}).easy.maps.small.hunters,11);
});
test('Nightmare sleeps on first effective hit and never increments the cycle during sleep',()=>{
  const m=new Monster();m.recoveryDuration=40;const hit=m.registerHit();assert.equal(hit.triggeredRecovery,true);assert.equal(m.recoverTimer,40);
  assert.equal(m.registerHit().triggeredRecovery,false);assert.equal(m.recoverTimer,40);
});
test('Heavy and Nightmare use map/difficulty counts with frozen team factor, never scaled HP',()=>{
  const g=Object.create(Game.prototype);g.state={selectedDifficulty:'medium',coop:{running:true,difficultyMultiplier:1.5}};
  assert.equal(typeof g._getEncounterSettings,'function');
  const m=g._getEncounterSettings('large');assert.equal(m.heavyCount,6);assert.equal(m.heavyHp,10);assert.equal(m.nightmareCount,5);assert.equal(m.nightmareSleep,30);
  g.state.selectedDifficulty='hard';const h=g._getEncounterSettings('large');assert.equal(h.heavyCount,8);assert.equal(h.heavyHp,20);assert.equal(h.nightmareCount,6);assert.equal(h.nightmareSleep,20);
  g.state.selectedDifficulty='easy';assert.equal(g._getEncounterSettings('large').heavyCount,0);
});
