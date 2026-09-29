const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test'),vm=require('node:vm');
const context={window:{addEventListener(){}}};
for(const file of ['config','game'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js',`${file}.js`),'utf8'),context);
const {Config,Game}=vm.runInNewContext('({Config,Game})',context);
function game(){const g=Object.create(Game.prototype);g.state={running:true,coop:{},stabilized:false,cameraLookX:0,cameraLookY:0,cameraZoom:1.56};g.player={x:500,y:500,angle:0};g.ui={frame:{getBoundingClientRect:()=>({left:0,top:0,width:Config.VIEW_W,height:Config.VIEW_H})}};g.renderer={prepareCamera(){}};return g;}
test('hip-fire camera smoothly looks in all directions and stays within the central half of the screen',()=>{
  for(const [nx,ny] of [[1,0],[-1,0],[0,1],[0,-1]]){const g=game();g.handleAim({clientX:Config.VIEW_W*(1+nx)/2,clientY:Config.VIEW_H*(1+ny)/2});g.advanceCamera(.12);
    assert.ok(Math.abs(g.state.cameraLookX)>0||Math.abs(g.state.cameraLookY)>0);
    for(let i=0;i<60;i++)g.advanceCamera(.05);
    assert.ok(Math.abs(g.state.cameraLookX*g.state.cameraZoom)<=Config.VIEW_W*.25+.001);assert.ok(Math.abs(g.state.cameraLookY*g.state.cameraZoom)<=Config.VIEW_H*.25+.001);
  }
});
test('camera projection keeps stationary pointer aim aligned after movement and recoil',()=>{
  const g=game();g.handleAim({clientX:600,clientY:200});g.advanceCamera(.12);g.player.x+=40;g.state.recoilX=12;g.state.recoilY=-7;g.advanceCamera(.016);
  const x=(g.state.mouseX-g.player.x-g.state.cameraLookX-g.state.recoilX)*g.state.cameraZoom+Config.VIEW_W/2;
  const y=(g.state.mouseY-g.player.y-g.state.cameraLookY-g.state.recoilY)*g.state.cameraZoom+Config.VIEW_H/2;
  assert.ok(Math.abs(x-600)<1e-8);assert.ok(Math.abs(y-200)<1e-8);
});
test('aim zoom retains screen-space look offset on release instead of recentering',()=>{
  const g=game();g.handleAim({clientX:800,clientY:100});g.advanceCamera(.3);g.setStableAim(true);assert.ok(Math.abs(g.state.cameraZoom-1.716)<1e-10);
  const offset=g.state.cameraLookX*g.state.cameraZoom;g.setStableAim(false);assert.equal(g.state.cameraZoom,1.56);assert.ok(Math.abs(g.state.cameraLookX*g.state.cameraZoom-offset)<1e-8);
});
test('open map, inventory and QTE freeze camera look until normal gameplay resumes',()=>{
  for(const field of ['fullMapOpen','inventoryOpen','pauseMenuOpen','activeQte']){const g=game();g.handleAim({clientX:800,clientY:100});g.advanceCamera(.12);const x=g.state.cameraLookX;g.state[field]=true;g.handleAim({clientX:0,clientY:0});g.advanceCamera(1);assert.equal(g.state.cameraLookX,x);}
});
