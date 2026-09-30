const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s={console,performance,structuredClone,window:{addEventListener(){}}};for(const f of ['config','inventory','entities','corpses','game'])vm.runInNewContext(fs.readFileSync(`js/${f}.js`,'utf8'),s);
const {Game,Player,EntitySpatialGrid,CorpseEffects}=vm.runInNewContext('({Game,Player,EntitySpatialGrid,CorpseEffects})',s);
test('same-cell reindex keeps its existing entry and original neighbor order',()=>{
  const grid=new EntitySpatialGrid(64),a={x:10,y:10},b={x:12,y:10};grid.rebuild([a,b]);const entry=grid.entries.get(a);
  a.x=14;grid.reindex(a);assert.equal(grid.entries.get(a),entry);assert.deepEqual([...grid.nearby(10,10,70)],[a,b]);
  a.x=100;grid.reindex(a);assert.notEqual(grid.entries.get(a),entry);assert.deepEqual([...grid.nearby(40,10,100)],[a,b]);
});
test('linear target selection preserves stealth, ties, current downed state and fallback without repeated roster queries',()=>{
  const g=Object.create(Game.prototype);g.player={x:0,y:0,noise:0};let queries=0;g._onlineCoopPlayers=()=>{queries++;return[g.player];};
  const players=[{x:250,y:0,noise:0},{x:300,y:0,noise:30},{x:-300,y:0,noise:30}],enemy={x:0,y:0,alerted:false};
  assert.equal(g._getThreatTarget(enemy,players),players[1]);players[1].downed=true;assert.equal(g._getThreatTarget(enemy,players),players[2]);
  enemy.alerted=true;assert.equal(g._getThreatTarget(enemy,players),players[0]);assert.equal(queries,0);
  players.forEach(p=>p.downed=true);assert.equal(g._getThreatTarget(enemy,players),g.player);
});
test('corpse poses encode only at send cadence and are shared across three independent peers',()=>{
  const g=Object.create(Game.prototype);g.state={coop:{running:true,role:'host'},missionFxId:'perf'};g.player=new Player();g._clearEnemyEffects();g.map={blocked:()=>false};
  g.remotePlayers=new Map(['a','b','c'].map(id=>[id,{id,online:true,player:new Player()}]));const sent=[];
  g.coopSession={peers:new Map(),sendEvent:(type,payload,id)=>{sent.push({id,payload});return true;}};
  const body={id:'corpse',kind:'hunter',seed:5,width:63,x:100,y:100,angle:0};CorpseEffects.initialize(body);g.corpseRegistry=[body];g._rebuildCorpseGrid();
  const original=CorpseEffects.pose;let packs=0;CorpseEffects.pose=record=>{packs++;return original.call(CorpseEffects,record);};
  try{
    g._updateCorpsePhysics(.01);assert.equal(packs,1);assert.equal(sent.length,3);assert.equal(sent[0].payload.poses[0],sent[1].payload.poses[0]);
    packs=0;sent.length=0;for(let i=0;i<3;i++)g._updateCorpsePhysics(.01);assert.equal(packs,0);assert.equal(sent.length,0);
    g._updateCorpsePhysics(.011);assert.equal(packs,1);assert.equal(sent.length,3);
  }finally{CorpseEffects.pose=original;}
});

test('moving corpse updates retain a twenty-Hz target at30,60 and120 simulation FPS',()=>{
  for(const fps of [30,60,120]){
    const g=Object.create(Game.prototype);g.state={coop:{running:true,role:'host'},missionFxId:'cadence'};g.player=new Player();g._clearEnemyEffects();g.map={blocked:()=>false};
    g.remotePlayers=new Map([['a',{id:'a',online:true,player:new Player()}]]);let sends=0;g.coopSession={peers:new Map(),sendEvent:()=>{sends++;return true;}};
    const body={id:'c',kind:'hunter',seed:5,width:63,x:500,y:500,angle:0};CorpseEffects.initialize(body);g.corpseRegistry=[body];g._rebuildCorpseGrid();
    const tick=()=>{const p=body.fragments[0];p.sleeping=false;p.vx=30;g.corpseActive.add(body);g._updateCorpsePhysics(1/fps);};
    tick();sends=0;for(let i=0;i<fps;i++)tick();assert.equal(sends,20,`${fps}FPS`);
  }
});
