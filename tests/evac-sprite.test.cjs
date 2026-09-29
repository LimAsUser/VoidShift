const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test'),vm=require('node:vm');
const sandbox={Image:class {constructor(){this.complete=true;this.naturalWidth=200;this.naturalHeight=100;}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/renderer.js'),'utf8')+'\nglobalThis.Renderer=Renderer;',sandbox);
test('every enemy uses a cached right-facing overhead image without stretching its proportions',()=>{
  const renderer=new sandbox.Renderer({}),draws=[];const ctx={drawImage:(...args)=>draws.push(args)};
  for(const name of ['monster','hunter','heavy']){
    const image=renderer.sprite(name);assert.equal(image.src,`resources/images/${name}-topdown.png`);
    assert.equal(renderer.sprite(name),image);renderer.drawEnemyBody(ctx,name,50);
  }
  assert.equal(draws.length,3);assert.deepEqual(draws[0].slice(1),[-25,-12.5,50,25]);
});
test('evac rings expand slowly in screen units and reduced motion stays static',()=>{
  const renderer=new sandbox.Renderer({});const radii=[],scales=[];
  const ctx={save(){},restore(){},translate(){},scale:(...args)=>scales.push(args),beginPath(){},arc:(_x,_y,r)=>radii.push(r),fill(){},stroke(){},fillRect(){},fillText(){}};
  renderer.drawEvacBeacon(ctx,{x:100,y:200},{elapsed:0},.5);const first=radii.slice();radii.length=0;
  renderer.drawEvacBeacon(ctx,{x:100,y:200},{elapsed:.6},.5);assert.notDeepEqual(radii,first);assert.deepEqual(scales[0],[2,2]);
  renderer.motionQuery={matches:true};radii.length=0;renderer.drawEvacBeacon(ctx,{x:100,y:200},{elapsed:0},1);const still=radii.slice();radii.length=0;
  renderer.drawEvacBeacon(ctx,{x:100,y:200},{elapsed:1.2},1);assert.deepEqual(radii,still);
});
