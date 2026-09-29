const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s={console};if(fs.existsSync('js/corpses.js'))vm.runInNewContext(fs.readFileSync('js/corpses.js','utf8'),s);
function api(){assert.equal(vm.runInNewContext('typeof CorpseEffects',s),'function');return vm.runInNewContext('CorpseEffects',s);}
function record(kind='hunter',seed=123){return {id:'body-'+seed,kind,seed,x:200,y:200,angle:.4,width:kind==='heavy'?112:63,born:0};}
test('seeded dismemberment is deterministic, bounded and partitions the sprite without missing corners',()=>{
 const C=api();for(const kind of ['hunter','heavy'])for(let seed=1;seed<25;seed++){
  const a=record(kind,seed),b=record(kind,seed);C.initialize(a);C.initialize(b);
  assert.equal(JSON.stringify(a.fragments),JSON.stringify(b.fragments));assert.ok(a.fragments.length>=(kind==='heavy'?6:4));assert.ok(a.fragments.length<=(kind==='heavy'?8:6));
  const area=C.geometry(seed,a.fragments.length).reduce((sum,g)=>sum+Math.abs(g.polygon.reduce((v,p,i)=>{const q=g.polygon[(i+1)%g.polygon.length];return v+p.x*q.y-q.x*p.y;},0))/2,0);
  assert.ok(Math.abs(area-1)<1e-8,'pieces cover the entire sprite rectangle');
 }
});
test('fragments settle, stop doing physics and can be nudged without moving the player',()=>{
 const C=api(),body=record();C.initialize(body);const map={blocked:()=>false};
 for(let i=0;i<150;i++)C.advance(body,.02,map,[]);
 assert.equal(body.fragments.every(p=>p.sleeping),true);const before=JSON.stringify(body.fragments);assert.equal(C.advance(body,.05,map,[]),false);assert.equal(JSON.stringify(body.fragments),before);
 const part=body.fragments[0],player={x:part.x,y:part.y,radius:10,dx:2,dy:0};const x=player.x;
 assert.equal(C.advance(body,.05,map,[player]),true);assert.equal(player.x,x);assert.ok(body.fragments.some(p=>!p.sleeping));
});
test('fast fragments cannot cross a closed wall or doorway and expired poses are ignored',()=>{
 const C=api(),body=record();C.initialize(body);body.fragments.forEach(p=>Object.assign(p,{x:190,y:200,vx:200,vy:0,spin:0,sleeping:false}));
 C.advance(body,.5,{blocked:(x)=>x>=200},[]);assert.ok(body.fragments.every(p=>p.x<200));
 const pose=C.pose(body);const clone=record();C.initialize(clone);assert.equal(C.applyPose(clone,pose),true);assert.equal(C.applyPose(clone,pose),false);
});
test('the full rotating fragment remains inside wall clearance, not only its center',()=>{
 const C=api(),body=record('heavy');body.x=145;const map={blocked:(x,y,r)=>x+r>=200};C.initialize(body,map);
 assert.ok(body.fragments.every(p=>Number.isFinite(p.radius)&&p.x+p.radius<200),'spawned fragment bounds are clear');
 body.fragments.forEach(p=>Object.assign(p,{vx:250,vy:0,spin:12,sleeping:false}));
 for(let i=0;i<20;i++)C.advance(body,.05,map,[]);
 assert.ok(body.fragments.every(p=>p.x+p.radius<200),'rotation and fast travel retain full clearance');
});
