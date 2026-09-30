const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={console};for(const name of ['config','inventory','entities','map'])vm.runInNewContext(fs.readFileSync(`js/${name}.js`,'utf8'),context);
const {MapManager}=vm.runInNewContext('({MapManager})',context);
const scan=(map,method,args)=>{const index=map._collisionIndex;map._collisionIndex=null;try{return map[method](...args);}finally{map._collisionIndex=index;}};
function sampleMap(){return Object.assign(Object.create(MapManager.prototype),{worldW:4096,worldH:4096,
  walls:[{x1:128,y1:64,x2:128,y2:256},{x:256,y:128,w:32,h:96},{x1:384,y1:128,x2:512,y2:256}],
  doors:[{p1:{x:512,y:256},p2:{x:512,y:384},open:false}]});}
test('indexed exact geometry keeps clearance, nearest hits and current door state',()=>{
  const map=sampleMap();assert.equal(typeof map.rebuildCollisionIndex,'function');map.rebuildCollisionIndex();
  assert.equal(map.blocked(120,100,10),true);assert.equal(map.blocked(100,100,10),false);
  assert.equal(map.rayWallDistance(100,100,1,0,1000),28);
  assert.equal(map.rayWallDistance(480,300,1,0,100),32);map.doors[0].open=true;assert.equal(map.rayWallDistance(480,300,1,0,100),100);
  assert.equal(map.blocked(507,340,44),false);map.doors[0].open=false;assert.equal(map.blocked(507,340,44),true);
});
test('small indexed queries do not evaluate remote wall geometry',()=>{
  const map=sampleMap();for(let i=0;i<1000;i++)map.walls.push({x:2000+i%20*48,y:2000+Math.floor(i/20)*24,w:12,h:12});
  assert.equal(typeof map.rebuildCollisionIndex,'function');map.rebuildCollisionIndex();let reads=0;
  for(const wall of map.walls.slice(3)){const x=wall.x;Object.defineProperty(wall,'x',{get(){reads++;return x;}});}
  map.blocked(100,100,10);map.rayWallDistance(100,100,1,0,60);assert.equal(reads,0);
});
test('array replacement, appended geometry and explicit in-place rebuild cannot leave stale collision',()=>{
  const map=sampleMap();assert.equal(typeof map.rebuildCollisionIndex,'function');map.rebuildCollisionIndex();
  map.walls.push({x:80,y:80,w:16,h:16});assert.equal(map.blocked(88,88,0),true);
  map.walls=[];assert.equal(map.rayWallDistance(100,100,1,0,1000),1000);
  map.walls.push({x:80,y:80,w:16,h:16});map.rebuildCollisionIndex();map.walls[0].x=800;map.rebuildCollisionIndex();assert.equal(map.blocked(88,88,0),false);
});
test('30 seeded layouts match full scans for rays, circles and doorway boundaries',()=>{
  let randomState=917;const random=()=>((randomState=Math.imul(randomState,1664525)+1013904223>>>0)/4294967296);
  for(const scale of ['small','medium','large'])for(let seed=1;seed<=10;seed++){
    const map=new MapManager(scale,seed*997,'hard');assert.ok(map._collisionIndex,'finished geometry has an index');
    const queries=Array.from({length:500},()=>({x:random()*map.worldW,y:random()*map.worldH,angle:random()*Math.PI*2,r:[0,10,22.5,44][Math.floor(random()*4)],distance:random()*2000}));
    for(const door of map.doors.slice(0,10))queries.push({x:door.p1.x,y:door.p1.y,angle:0,r:44,distance:800});
    for(let phase=0;phase<3;phase++){
      map.doors.forEach((door,i)=>door.open=phase===1||phase===2&&i%2===0);
      for(const q of queries){
        const args=[q.x,q.y,q.r];assert.equal(map.blocked(...args),scan(map,'blocked',args),`${scale}/${seed} circle`);
        const ray=[q.x,q.y,Math.cos(q.angle),Math.sin(q.angle),q.distance];assert.ok(Math.abs(map.rayWallDistance(...ray)-scan(map,'rayWallDistance',ray))<1e-8,`${scale}/${seed} ray`);
      }
    }
  }
});
