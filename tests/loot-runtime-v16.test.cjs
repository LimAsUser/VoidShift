const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const ctx=vm.createContext({window:{},structuredClone});for(const file of ['config','inventory','loot']){const p=path.join(__dirname,'../js',file+'.js');if(fs.existsSync(p))vm.runInContext(fs.readFileSync(p,'utf8'),ctx);}
const {LootController,BackpackManager}=vm.runInContext('({LootController:typeof LootController==="undefined"?null:LootController,BackpackManager})',ctx);
function fixture(){assert.ok(LootController,'loot runtime exists');const events=[];const game={state:{running:true,missionFxId:'m',coop:{role:'host',running:true},inventory:[],elapsed:1},player:{x:100,y:100,radius:10},backpack:new BackpackManager(8,5),map:{containers:[{id:'c1',x:130,y:100,fixed:true,revision:0,items:[{id:'i1',shape:'1x2',value:30,gx:0,gy:0,rot:0}]}],rayWallDistance:()=>10000},remotePlayers:new Map(),coopSession:{sendEvent:(...args)=>{events.push(args);return true;}},ui:{showToast(){}},_tutorialAction(){},updateInventoryUI(){},_syncLegacyRemoteAliases(){}};return{game,loot:new LootController(game),events};}
test('host-authoritative take broadcasts the shared box, attributes loot to the taker and echoes replay without duplication',()=>{
 const f=fixture();const player={x:110,y:100,noise:10},backpack=new BackpackManager(8,5);f.game.remotePlayers.set('p2',{id:'p2',player,backpack,inventory:backpack.items,online:true});
 const req={missionId:'m',requestId:1,containerId:'c1',itemId:'i1',action:'take'};
 assert.equal(f.loot.handleRequest(req,'p2').accepted,true);assert.equal(backpack.items.length,1);assert.equal(f.game.backpack.items.length,0);
 assert.equal(f.game.map.containers[0].items.length,0);assert.ok(f.events.some(e=>e[0]==='loot-update'));
  assert.equal(f.loot.handleRequest(req,'p2').accepted,true);assert.equal(backpack.items.length,1);
  assert.equal(player.noise,15,'the original pickup noise happens once, not again on replay');
 assert.equal(f.loot.handleRequest({...req,missionId:'old'},'p2').accepted,false);
});
test('discarded full backpacks become bounded searchable bags with every item retained',()=>{
 const f=fixture();const items=Array.from({length:40},(_,id)=>({id:`drop${id}`,shape:'1x1',value:10}));
 f.loot.dropItems(items,{x:100,y:100});const bags=f.game.map.containers.filter(c=>!c.fixed);
 assert.equal(bags.flatMap(b=>b.items).length,40);assert.equal(new Set(bags.flatMap(b=>b.items.map(i=>i.id))).size,40);
 for(const b of bags){const grid=new BackpackManager(6,6);grid.items=b.items;assert.ok(grid.usedCells()<=36);}
});

test('selecting a crate item clears the previous backpack use selection',()=>{
 const f=fixture();f.game.state.lootContainerId='c1';f.game.selectedItemId='bag-medkit';
 const buttons=new Map();ctx.document={getElementById:id=>{if(!buttons.has(id))buttons.set(id,{});return buttons.get(id);}};
 const tile={dataset:{itemId:'i1'},getBoundingClientRect:()=>({left:0,top:0,width:34,height:72})};
 f.loot.startDrag({button:0,clientX:10,clientY:10,target:{closest:()=>tile},preventDefault(){},stopImmediatePropagation(){}},'crate');
 assert.equal(f.game.selectedItemId,null);
});
