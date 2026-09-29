const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const sandbox = { performance: { now: () => sandbox.now || 0 } };
for (const file of ['config','map','entities','audio']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8'), sandbox);
const { Heavy, MapManager, AudioManager } = vm.runInNewContext('({Heavy,MapManager,AudioManager})', sandbox);

function cornerMap() {
  const map = Object.create(MapManager.prototype);
  map.worldRooms = [{id:0,x:350,y:350,w:300,h:300,center:{x:500,y:500},doors:[],vertices:[{x:350,y:350},{x:650,y:350},{x:650,y:650},{x:350,y:650}]}];
  map.doors=[];
  map.walls=[{x1:640,y1:350,x2:640,y2:650},{x:535,y:445,w:10,h:110}];
  return map;
}

test('Heavy completes the route to an attack position when the players center cannot fit its body', () => {
  const map=cornerMap(), heavy=new Heavy(20), player={x:620,y:500,radius:10};
  heavy.activate(500,500);
  assert.equal(map.blocked(player.x,player.y,heavy.radius),true);
  for(let i=0;i<600 && heavy.phase==='pursuit';i++) {
    const previous={x:heavy.x,y:heavy.y};
    heavy.update(.025,player,map,[player]);
    assert.equal(map.blocked(heavy.x,heavy.y,heavy.radius),false);
    assert.ok(Math.hypot(heavy.x-previous.x,heavy.y-previous.y)<=1.251,'must walk, never nudge through geometry');
  }
  assert.equal(heavy.phase,'windup');
});

test('wall impact recovers after three seconds while a flash still extends to five', () => {
  const map=cornerMap(), heavy=new Heavy(20), player={x:620,y:500,radius:10};
  heavy.activate(600,500);heavy.phase='charge';heavy.chargeAngle=0;
  heavy.update(.1,player,map,[player]);
  assert.equal(heavy.phase,'stunned');
  heavy.update(2.9,player,map,[player]);assert.equal(heavy.phase,'stunned');
  heavy.update(.11,player,map,[player]);assert.equal(heavy.phase,'pursuit');
  heavy.stun(3);heavy.stun(5);heavy.update(3.1,player,map,[player]);
  assert.equal(heavy.phase,'stunned');
});

test('Heavy-only spatial steps follow movement cadence and stop while stunned or idle', () => {
  const audio=new AudioManager(), tones=[];
  audio.context={currentTime:0};audio.playSpatialTone=(...args)=>tones.push(args);
  const listener={x:500,y:500,angle:0}, heavy={x:500,y:600,active:true,dead:false,phase:'pursuit'};
  const map={rayWallDistance:(_x,_y,_dx,_dy,d)=>d};
  sandbox.now=0;audio.update(listener,{active:false},map,[],heavy);
  for(let i=1;i<=18;i++){sandbox.now=i*100;heavy.x+=5;audio.update(listener,{active:false},map,[],heavy);}
  assert.equal(tones.length,4,'two layered footsteps in 1.8s');
  assert.ok(tones[0][0]<100);assert.ok(tones[0][4]>0);
  const previous=tones.length;
  sandbox.now=4000;audio.update(listener,{active:false},map,[],heavy);
  heavy.phase='stunned';heavy.x+=10;sandbox.now=5000;audio.update(listener,{active:false},map,[],heavy);
  assert.equal(tones.length,previous);
});

test('Heavy opens a real closed doorway and charges through it to contact the player',()=>{
  const map=Object.create(MapManager.prototype);
  const room=(id,x)=>({id,x,y:350,w:300,h:300,center:{x:x+150,y:500},doors:[],vertices:[{x,y:350},{x:x+300,y:350},{x:x+300,y:650},{x,y:650}]});
  const a=room(0,350),b=room(1,650);
  const door={id:'door',p1:{x:650,y:436},p2:{x:650,y:564},normal:{x:1,y:0},axis:'v',roomA:a,roomB:b,open:false,targetOpen:false,animationProgress:0};
  a.doors=[door];b.doors=[door];map.worldRooms=[a,b];map.doors=[door];
  map.walls=[{x1:650,y1:350,x2:650,y2:436},{x1:650,y1:564,x2:650,y2:650}];
  const heavy=new Heavy(20),player={x:820,y:500,radius:10};heavy.activate(500,500);let hit=false;
  for(let i=0;i<600&&!hit;i++){map.advanceDoorAnimations(.025,[player],[heavy]);hit=heavy.update(.025,player,map,[player]).hits.includes(player);assert.equal(map.blocked(heavy.x,heavy.y,22),false);}
  assert.equal(door.open,true);assert.equal(hit,true);assert.ok(heavy.x>650);
});

test('charging Heavy has a faster rhythm and walls attenuate its local footsteps',()=>{
  const run=blocked=>{const audio=new AudioManager(),tones=[];audio.context={currentTime:0};audio.playSpatialTone=(...args)=>tones.push(args);
    const heavy={x:500,y:550,phase:'charge',active:true},player={x:500,y:500,angle:0};const map={rayWallDistance:(_x,_y,_dx,_dy,d)=>blocked?10:d};
    for(let i=0;i<=9;i++){sandbox.now=i*100;heavy.x+=5;audio.update(player,{active:false},map,[],heavy);}return tones;};
  const clear=run(false),blocked=run(true);assert.equal(clear.length,6);assert.equal(blocked.length,6);assert.ok(Math.abs(blocked[0][5]/clear[0][5]-.3)<1e-10);
});
