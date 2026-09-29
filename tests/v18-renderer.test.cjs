const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){const calls=[];const ctx={globalAlpha:1};for(const key of ['save','restore','translate','rotate','scale','beginPath','moveTo','lineTo','clip','arc','fill','closePath','drawImage','fillRect'])ctx[key]=(...args)=>calls.push({key,args});
 const s={window:{matchMedia:()=>({matches:false})},Image:class{constructor(){this.complete=true;this.naturalWidth=1536;this.naturalHeight=1024;}},document:{createElement:()=>({getContext:()=>ctx})}};
 for(const f of ['corpses','renderer'])vm.runInNewContext(fs.readFileSync(`js/${f}.js`,'utf8'),s);
 const {Renderer,CorpseEffects}=vm.runInNewContext('({Renderer,CorpseEffects})',s),renderer=new Renderer({});renderer.visibleWorldPoint=p=>p.x<1000;renderer.inViewport=()=>true;
 const record={id:'h',kind:'hunter',seed:45,x:100,y:100,width:63,angle:0,born:0};CorpseEffects.initialize(record);
 return {renderer,record,ctx,calls};}
test('true corpses draw separately clipped live-sprite fragments and ground blood, not a down-image swap',()=>{
 const f=setup();assert.equal(typeof f.renderer.drawCorpseFragments,'function');
 f.renderer.drawCorpseFragments(f.ctx,f.record,{}, {rayWallDistance:(_x,_y,_a,_b,d)=>d},{elapsed:.2});
 assert.equal(f.calls.filter(c=>c.key==='clip').length,f.record.fragments.length);
 assert.equal(f.calls.filter(c=>c.key==='drawImage').length,f.record.fragments.length);
 assert.ok(f.calls.filter(c=>c.key==='drawImage').every(c=>c.args[0].src.endsWith('hunter-topdown.png')));
 assert.ok(f.calls.some(c=>c.key==='arc'));
});
test('reconnect and reduced motion retain static blood/pieces without replaying blood spray',()=>{
 const f=setup();assert.equal(typeof f.renderer.drawCorpseFragments,'function');const map={rayWallDistance:(_x,_y,_a,_b,d)=>d};
 f.record.suppressBurst=true;f.renderer.drawCorpseFragments(f.ctx,f.record,{},map,{elapsed:.2});const count=f.calls.filter(c=>c.key==='arc').length;
 f.calls.length=0;f.record.suppressBurst=false;f.renderer.motionQuery.matches=true;f.renderer.drawCorpseFragments(f.ctx,f.record,{},map,{elapsed:.2});
 assert.equal(f.calls.filter(c=>c.key==='arc').length,count);
});
test('unseen fragments and blood do not render',()=>{
 const f=setup();assert.equal(typeof f.renderer.drawCorpseFragments,'function');f.renderer.visibleWorldPoint=()=>false;
 f.renderer.drawCorpseFragments(f.ctx,f.record,{}, {},{elapsed:.2});assert.equal(f.calls.filter(c=>c.key==='drawImage'||c.key==='arc').length,0);
});
test('blood stain circles respect their radius at a wall instead of only clipping the center',()=>{
 for(let seed=1;seed<=30;seed++){
  const f=setup();Object.assign(f.record,{kind:'heavy',width:112,seed});
  const map={blocked:(x,y,r)=>x+r>=153,rayWallDistance:(x,y,dx,dy,d)=>dx>0?Math.min(d,(153-x)/dx):d};
  f.renderer.drawCorpseFragments(f.ctx,f.record,{},map,{elapsed:3});
  assert.ok(f.renderer.corpseLayouts.get(f.record.id).stains.every(p=>p.x+p.r<153));
 }
});
