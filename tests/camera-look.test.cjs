const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test'),vm=require('node:vm');
const context={window:{addEventListener(){}}};
for(const file of ['config','entities','game'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js',`${file}.js`),'utf8'),context);
const {Config,Game}=vm.runInNewContext('({Config,Game})',context);
function game(){const g=Object.create(Game.prototype);g.state={running:true,coop:{},stabilized:false,cameraLookX:0,cameraLookY:0,cameraZoom:Config.camera.baseZoom};g.player={x:500,y:500,angle:0};g.ui={frame:{getBoundingClientRect:()=>({left:0,top:0,width:Config.VIEW_W,height:Config.VIEW_H})}};g.renderer={prepareCamera(){}};return g;}
test('hip-fire camera smoothly looks in all directions and caps displacement at fifteen percent per axis',()=>{
  for(const [nx,ny] of [[1,0],[-1,0],[0,1],[0,-1]]){const g=game();g.handleAim({clientX:Config.VIEW_W*(1+nx)/2,clientY:Config.VIEW_H*(1+ny)/2});g.advanceCamera(.12);
    assert.ok(Math.abs(g.state.cameraLookX)>0||Math.abs(g.state.cameraLookY)>0);
    for(let i=0;i<60;i++)g.advanceCamera(.05);
    assert.ok(Math.abs(g.state.cameraLookX*g.state.cameraZoom)<=Config.VIEW_W*.15+.001);assert.ok(Math.abs(g.state.cameraLookY*g.state.cameraZoom)<=Config.VIEW_H*.15+.001);
  }
});
test('camera projection keeps stationary pointer aim aligned after movement and recoil',()=>{
  const g=game();g.handleAim({clientX:600,clientY:200});g.advanceCamera(.12);g.player.x+=40;g.state.recoilX=12;g.state.recoilY=-7;g.setStableAim(true);g.advanceCamera(.016);
  const x=(g.state.mouseX-g.player.x-g.state.cameraLookX-g.state.recoilX)*g.state.cameraZoom+Config.VIEW_W/2;
  const y=(g.state.mouseY-g.player.y-g.state.cameraLookY-g.state.recoilY)*g.state.cameraZoom+Config.VIEW_H/2;
  assert.ok(Math.abs(x-600)<1e-8);assert.ok(Math.abs(y-200)<1e-8);
});
test('the same world target remains under the pointer across viewport and CSS zoom equivalents',()=>{
  for(const [width,height] of [[1280,720],[1920,1080],[390,844]])for(const scale of [1,1.25,2])for(const zoom of [1.25,1.31,1.375]){
    const g=game(),rect={left:37,top:29,width:width/scale,height:height/scale};
    g.ui.frame.getBoundingClientRect=()=>rect;
    Object.assign(g.state,{cameraZoom:zoom,cameraLookX:17,cameraLookY:-9,recoilX:6,recoilY:-4});
    g.handleAim({clientX:rect.left+rect.width/2+(620-500-17-6)*zoom*rect.width/900,
      clientY:rect.top+rect.height/2+(415-500+9+4)*zoom*rect.height/602});
    assert.ok(Math.abs(g.state.mouseX-620)<1e-8);
    assert.ok(Math.abs(g.state.mouseY-415)<1e-8);
    assert.ok(Math.abs(g.player.angle-Math.atan2(-85,120))<1e-10);
    assert.deepEqual([g.player.x,g.player.y],[500,500]);
  }
});
test('camera starts at normal zoom and missing state initializes without a transition',()=>{
  const g=game();g.handleAim({clientX:450,clientY:301});assert.equal(g.state.cameraZoom,1.25);
  delete g.state.cameraZoom;g.advanceCamera(0);assert.equal(g.state.cameraZoom,1.25);
});
test('aim zoom approaches 1.375 and normal zoom exponentially with a tenth-second time constant',()=>{
  const g=game();g.setStableAim(true);assert.equal(g.state.cameraZoom,1.25);
  g.advanceCamera(.1);assert.ok(Math.abs(g.state.cameraZoom-1.3290150698535697)<1e-10);
  g.setStableAim(false);assert.ok(Math.abs(g.state.cameraZoom-1.3290150698535697)<1e-10);
  g.advanceCamera(.1);assert.ok(Math.abs(g.state.cameraZoom-1.2790680197418538)<1e-10);
  g.setStableAim(true);for(let i=0;i<30;i++)g.advanceCamera(.1);
  assert.ok(Math.abs(g.state.cameraZoom-1.375)<1e-10);
});
test('zoom and look have the same result across frame rates',()=>{
  const once=game(),split=game();
  for(const g of [once,split]){g.handleAim({clientX:900,clientY:602});g.setStableAim(true);}
  once.advanceCamera(.1);for(let i=0;i<10;i++)split.advanceCamera(.01);
  assert.ok(Math.abs(once.state.cameraZoom-split.state.cameraZoom)<1e-10);
  assert.ok(Math.abs(once.state.cameraLookX*once.state.cameraZoom-85.33627544185528)<1e-8);
  assert.ok(Math.abs(once.state.cameraLookX*once.state.cameraZoom-split.state.cameraLookX*split.state.cameraZoom)<1e-8);
  assert.ok(Math.abs(once.state.cameraLookY*once.state.cameraZoom-split.state.cameraLookY*split.state.cameraZoom)<1e-8);
});
test('zero-dt pointer and aim events only update aim through the current camera transform',()=>{
  const g=game();Object.assign(g.state,{cameraLookX:50,cameraLookY:-20,recoilX:.01,recoilY:-.02});
  g.setStableAim(true);g.handleAim({clientX:900,clientY:0});
  assert.equal(g.state.cameraZoom,1.25);assert.equal(g.state.cameraLookX,50);assert.equal(g.state.cameraLookY,-20);
  assert.equal(g.state.recoilX,.01);assert.equal(g.state.recoilY,-.02);
  assert.ok(Math.abs(g.state.mouseX-910.01)<1e-8);assert.ok(Math.abs(g.state.mouseY-239.18)<1e-8);
  assert.ok(Math.abs(g.player.angle-Math.atan2(-260.82,410.01))<1e-10);
});
test('reduced motion applies zoom immediately on the next frame without adding sway',()=>{
  context.window.matchMedia=()=>({matches:true});
  try{const g=game();g.handleAim({clientX:450,clientY:301});g.setStableAim(true);
    assert.equal(g.state.cameraZoom,1.25);g.advanceCamera(.016);assert.equal(g.state.cameraZoom,1.375);
    assert.equal(g.state.cameraLookX,0);assert.equal(g.state.cameraLookY,0);
    g.setStableAim(false);g.advanceCamera(.016);assert.equal(g.state.cameraZoom,1.25);
  }finally{delete context.window.matchMedia;}
});
test('all existing UI locks freeze zoom, look and recoil until normal gameplay resumes',()=>{
  for(const field of ['transitioning','fullMapOpen','fullMapClosing','inventoryOpen','inventoryClosing','pauseMenuOpen','activeQte','hostPaused','tutorialPaused','stopped']){
    const g=game();g.handleAim({clientX:800,clientY:100});g.advanceCamera(.12);
    if(field==='hostPaused')g.state.coop.hostPaused=true;else if(field==='tutorialPaused')g.state.tutorial={paused:true};else if(field==='stopped')g.state.running=false;else g.state[field]=true;
    Object.assign(g.state,{stabilized:true,recoilX:12,recoilY:-7});const before=[g.state.cameraZoom,g.state.cameraLookX,g.state.cameraLookY,g.state.recoilX,g.state.recoilY,g.player.angle];
    g.handleAim({clientX:0,clientY:0});g.advanceCamera(1);
    assert.deepEqual([g.state.cameraZoom,g.state.cameraLookX,g.state.cameraLookY,g.state.recoilX,g.state.recoilY,g.player.angle],before,field);
  }
});
test('powered-room actor discovery keeps its original world range after camera changes',()=>{
  const visible=vm.runInNewContext('isPointVisibleToPlayer',context);
  const observer={x:0,y:0,angle:0,flashlight:false};
  const map={getRoomAt:()=>({lights:[{}]}),rayWallDistance:(x,y,dx,dy,distance)=>distance};
  const oldZoom=Config.camera.baseZoom;Config.camera.baseZoom=1.25;
  try{assert.equal(visible(694,0,observer,map,true),true);assert.equal(visible(695,0,observer,map,true),false);
    Config.camera.baseZoom=2;assert.equal(visible(694,0,observer,map,true),true);
    assert.equal(visible(695,0,observer,map,true),false);
  }finally{Config.camera.baseZoom=oldZoom;}
});
test('camera changes preserve flashlight, near visibility and wall clipping for actor discovery',()=>{
  const visible=vm.runInNewContext('isPointVisibleToPlayer',context);
  const observer={x:0,y:0,angle:0,flashlight:false};
  const map={getRoomAt:()=>({lights:[]}),rayWallDistance:(x,y,dx,dy,distance)=>distance};
  assert.equal(visible(126,0,observer,map,false),true);assert.equal(visible(127,0,observer,map,false),false);
  assert.equal(visible(-74,0,observer,map,false),true);assert.equal(visible(-75,0,observer,map,false),false);
  observer.flashlight=true;assert.equal(visible(420,0,observer,map,false),true);assert.equal(visible(421,0,observer,map,false),false);
  map.rayWallDistance=()=>50;assert.equal(visible(74,0,observer,map,false),false);
});
