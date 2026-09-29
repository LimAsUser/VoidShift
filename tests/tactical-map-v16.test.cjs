const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const ctx=vm.createContext({window:{addEventListener(){},devicePixelRatio:1}});for(const file of ['config','renderer','game'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),ctx);
const {Game,Renderer}=vm.runInContext('({Game,Renderer})',ctx);
test('opening map centres this player at 1.5 fit zoom while fit-all remains neutral',()=>{
 const g=Object.create(Game.prototype);g.state={};g.map={worldRooms:[{x:0,y:0,w:2000,h:1000}]};g.player={x:200,y:700};
 g.ui={fullMapCanvas:{width:800,height:600,classList:{remove(){}}}};g.renderer=Object.create(Renderer.prototype);
 assert.equal(typeof g.centerFullMapOnPlayer,'function');g.centerFullMapOnPlayer();
 const fit=g.renderer.getFullMapFit(g.map,800,600);assert.equal(g.state.fullMapZoom,1.5);
 assert.equal((g.player.x*fit.scale+fit.offsetX)*1.5+g.state.fullMapPanX,400);
 assert.equal((g.player.y*fit.scale+fit.offsetY)*1.5+g.state.fullMapPanY,300);
 g.state.fullMapOpen=false;g.resetFullMapView();assert.equal(g.state.fullMapZoom,1);assert.equal(g.state.fullMapPanX,0);
});
