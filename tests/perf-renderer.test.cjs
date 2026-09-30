const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
  const buffers=[];let now=0;
  function canvas(){const calls=[];const context=new Proxy({globalAlpha:1,getTransform:()=>({a:1,d:1}),createPattern:()=>null,createRadialGradient:()=>({addColorStop(){}})},
    {get(t,key){return key in t?t[key]:(t[key]=(...args)=>{calls.push({key,args});});}});return{width:800,height:600,clientWidth:800,clientHeight:600,style:{},calls,getContext:()=>context};}
  const c={console,performance:{now:()=>now},window:{matchMedia:()=>({matches:false})},Image:class{constructor(){this.complete=true;this.naturalWidth=1536;this.naturalHeight=1024;}},
    document:{createElement(){now+=1.1;const value=canvas();buffers.push(value);return value;}}};
  for(const f of ['config','inventory','entities','map','corpses','renderer'])vm.runInNewContext(fs.readFileSync(`js/${f}.js`,'utf8'),c);
  const {Renderer,CorpseEffects,Player}=vm.runInNewContext('({Renderer,CorpseEffects,Player})',c),world=canvas(),vision=canvas();
  const r=new Renderer({canvas:world,ctx:world.getContext(),visionCanvas:vision,visionCtx:vision.getContext()});
  const p=new Player();p.x=100;p.y=100;p.angle=0;
  const map={worldRooms:[],walls:[],doors:[],terminals:[],scrap:[],windows:[],containers:[],getRoomAt:()=>null,rayWallDistance:(_x,_y,_dx,_dy,d)=>d};
  const state={elapsed:3,cameraZoom:1,selectedDifficulty:'hard',corpses:[],heavies:[],nightmares:[],bulletTraces:[],impactParticles:[],damageNumbers:[]};
  const body={id:'h',kind:'hunter',seed:45,x:160,y:100,width:63,angle:0,born:0};CorpseEffects.initialize(body);
  const frame=()=>{assert.equal(typeof r._beginRenderFrame,'function');r._beginRenderFrame(p,map,state);};
  return{r,p,map,state,body,world,ctx:world.getContext(),buffers,frame};
}
test('warm corpse textures avoid runtime polygon clips and retain every independently moving piece',()=>{
  const f=setup();for(let i=0;i<12;i++){f.frame();f.r.drawCorpseFragments(f.ctx,f.body,f.p,f.map,f.state);}
  assert.ok(f.r.corpseTextureBytes>0);f.world.calls.length=0;f.body.fragments[0].x+=5;f.body.fragments[0].angle+=.5;
  f.frame();f.r.drawCorpseFragments(f.ctx,f.body,f.p,f.map,f.state);
  assert.equal(f.world.calls.filter(c=>c.key==='clip').length,0);assert.equal(f.world.calls.filter(c=>c.key==='drawImage').length,f.body.fragments.length);
  assert.ok(f.world.calls.some(c=>c.key==='translate'&&c.args[0]===f.body.fragments[0].x));
});
test('bitmap budget and construction budget fall back without deleting any fragments; cleanup frees bytes',()=>{
  const f=setup();f.frame();f.r.drawCorpseFragments(f.ctx,f.body,f.p,f.map,f.state);
  assert.ok(f.buffers.length<f.body.fragments.length,'first frame does not build all pieces');
  f.r.clearCorpseTextures();assert.equal(f.r.corpseTextureBytes,0);
  f.r.corpseTextureBudget=1;f.world.calls.length=0;f.frame();f.r.drawCorpseFragments(f.ctx,f.body,f.p,f.map,f.state);
  assert.equal(f.r.corpseTextureBytes,0);assert.equal(f.world.calls.filter(c=>c.key==='drawImage').length,f.body.fragments.length);
});
test('offscreen whole corpse skips texture and visibility work without hiding onscreen scattered pieces',()=>{
  const f=setup();f.body.x=5000;f.body.fragments.forEach(p=>p.x+=5000);let visible=0;const original=f.r.visibleWorldPoint.bind(f.r);
  f.r.visibleWorldPoint=(...args)=>{visible++;return original(...args);};f.frame();f.r.drawCorpseFragments(f.ctx,f.body,f.p,f.map,f.state);
  assert.equal(visible,0);assert.equal(f.buffers.length,0);
  f.body.fragments[0].x=130;f.body.fragments[0].y=100;f.frame();f.r.drawCorpseFragments(f.ctx,f.body,f.p,f.map,f.state);assert.ok(visible>0);
});
test('same-frame visibility reuses exact positions but does not survive a new frame or changed observer',()=>{
  const f=setup();let rays=0;f.map.rayWallDistance=(_x,_y,_dx,_dy,d)=>{rays++;return d;};
  f.frame();f.r.visibleWorldPoint({x:120,y:100},f.p,f.map,f.state);f.r.visibleWorldPoint({x:120,y:100},f.p,f.map,f.state);assert.equal(rays,1);
  f.p.angle=.4;f.frame();f.r.visibleWorldPoint({x:120,y:100},f.p,f.map,f.state);assert.equal(rays,2);
});

test('unchanged visibility context reuses exact results across frames and invalidates immediately on a door change',()=>{
  const f=setup();let rays=0;f.map.doors=[{open:true}];f.map.rayWallDistance=(_x,_y,_dx,_dy,d)=>{rays++;return f.map.doors[0].open?d:0;};
  f.frame();assert.equal(f.r.visibleWorldPoint({x:120,y:100},f.p,f.map,f.state),true);
  f.frame();assert.equal(f.r.visibleWorldPoint({x:120,y:100},f.p,f.map,f.state),true);assert.equal(rays,1);
  f.map.doors[0].open=false;f.frame();assert.equal(f.r.visibleWorldPoint({x:120,y:100},f.p,f.map,f.state),false);assert.equal(rays,2);
});

test('stable point objects avoid rebuilding coordinate-cache lookups until their position changes',()=>{
  const f=setup(),point={x:120,y:100};f.frame();f.frame();f.r.visibleWorldPoint(point,f.p,f.map,f.state);
  const cache=f.r._visibilityFrame.cache,has=cache.has.bind(cache);let lookups=0;cache.has=key=>{lookups++;return has(key);};
  for(let i=0;i<20;i++)f.r.visibleWorldPoint(point,f.p,f.map,f.state);assert.equal(lookups,0);
  point.x=121;f.r.visibleWorldPoint(point,f.p,f.map,f.state);assert.equal(lookups,1);
});

test('texture resolution covers the display scale without jumping to a wasteful double-sized raster',()=>{
  const f=setup();Object.assign(f.r.ui.canvas,{clientWidth:1280,clientHeight:768});f.state.cameraZoom=1.56;f.frame();
  const required=1280/900*1.56;assert.ok(f.r._corpseTextureScale>=required);assert.ok(f.r._corpseTextureScale<required+.25);
});

test('warm fragment rendering resolves the source identity once per corpse rather than per piece',()=>{
  const f=setup();for(let i=0;i<12;i++){f.frame();f.r.drawCorpseFragments(f.ctx,f.body,f.p,f.map,f.state);}
  const image=f.r.sprite('hunter'),src=image.src;let reads=0;Object.defineProperty(image,'src',{get(){reads++;return src;}});
  f.frame();f.r.drawCorpseFragments(f.ctx,f.body,f.p,f.map,f.state);assert.ok(reads<=1);
});

test('camera-only changes still cull points with cached unobstructed visibility',()=>{
  const f=setup();f.frame();assert.equal(f.r.visibleWorldPoint({x:120,y:100},f.p,f.map,f.state),true);
  f.r.cameraOffsetX=-5000;f.frame();assert.equal(f.r.visibleWorldPoint({x:120,y:100},f.p,f.map,f.state),false);
});

test('a large fragment whose center is offscreen remains visible while its edge intersects the viewport',()=>{
  const f=setup();f.p.x=700;f.frame();assert.equal(f.r.visibleWorldPoint({x:960,y:100,radius:80},f.p,f.map,f.state),true);
});
test('offscreen living bodies are culled but a Heavy warning crossing the viewport remains',()=>{
  const f=setup();let bodies=0;f.r.drawEnemyBody=()=>{bodies++;return true;};f.r.heavyChargeDistance=()=>5000;
  f.state.heavies=[{active:true,dead:false,x:2000,y:100,angle:Math.PI,chargeAngle:Math.PI,radius:44,phase:'windup'}];f.state.selectedDifficulty='medium';
  f.r.draw(f.p,null,f.map,f.state,[{active:true,dead:false,x:3000,y:100,angle:0}],[]);
  assert.equal(bodies,0);assert.ok(f.world.calls.some(c=>c.key==='lineTo'&&c.args[0]===-3000),'warning survives body culling');
});
