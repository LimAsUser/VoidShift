const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test'),vm=require('node:vm');
function fixture(failLarge=false){
  const frames=[],renders=[],constructs=[];
  const element=()=>({textContent:'',children:[],dataset:{},classList:{toggle(){}},setAttribute(){},append(...x){this.children.push(...x);},replaceChildren(...x){this.children=x;}});
  const scales=['small','medium','large'];const cards=scales.map(scale=>({...element(),dataset:{draftScale:scale},querySelector:()=>element()}));
  const canvases=scales.map(scale=>({...element(),dataset:{mapPreview:scale},clientWidth:0,clientHeight:0}));
  const enemies=Object.fromEntries(scales.map(s=>[s,element()]));const statuses=Object.fromEntries(scales.map(s=>[s,element()]));
  const controls={menuMapConfirm:element(),menuMapReadOnly:element()};
  const doc={createElement:element,createTextNode:text=>({textContent:text}),getElementById:id=>controls[id],querySelectorAll:s=>s==='[data-draft-scale]'?cards:s==='[data-map-preview]'?canvases:[],querySelector:s=>{const key=s.match(/="(\w+)"/)?.[1];return s.includes('data-map-enemies')?enemies[key]:statuses[key];}};
  const sandbox={window:{addEventListener(){}},document:doc,Config:{currentScale:'large',mapScales:{small:{},medium:{},large:{}}},
    requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){},
    MapManager:class {constructor(scale,seed,difficulty){this.difficulty=difficulty;constructs.push([scale,seed]);if(failLarge&&scale==='large')throw Error('bad layout');this.reset(scale,seed);}reset(scale,seed){if(failLarge&&scale==='large')throw Error('bad layout');this.seed=seed;this.enemyTypes=['heavy'];}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/menu.js'),'utf8')+'\nglobalThis.Menu=SafehouseMenu;',sandbox);
  const menu=Object.create(sandbox.Menu.prototype);menu.game={state:{coop:{}},_previewDifficulty:()=> 'medium',_ensureMenuMapSeeds:()=>({small:1,medium:2,large:3})};
  menu.mapDialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
  menu.drawMapPreview=(canvas,map)=>{renders.push(canvas.dataset.mapPreview);return !!canvas.clientWidth;};
  return{menu,frames,renders,enemies,statuses,controls,canvases,constructs};
}
test('first opening fills all enemy rows before deferred canvas painting and keeps selected seeds',()=>{
  const f=fixture();f.menu.openMapDialog();
  assert.equal(f.renders.length,0);assert.equal(f.enemies.large.children.length,2);
  f.canvases.forEach(c=>{c.clientWidth=300;c.clientHeight=140;});f.frames.shift()();
  assert.deepEqual(f.renders,['small','medium','large']);
  assert.deepEqual(f.constructs,[['small',1],['medium',2],['large',3]]);
});

test('an already-open Guest map follows new host seeds and difficulty without closing the dialog',()=>{
  const f=fixture();f.menu.game.state.coop.role='guest';
  f.menu.game.getMenuPreviewMap=scale=>({seed:f.menu.game._ensureMenuMapSeeds()[scale],difficulty:f.menu.game._previewDifficulty(),enemyTypes:['heavy']});
  f.menu.openMapDialog();const draft=f.menu.mapDraft;
  f.menu.game._ensureMenuMapSeeds=()=>({small:11,medium:22,large:33});f.menu.game._previewDifficulty=()=> 'hard';
  f.menu._refreshMapDialog();assert.equal(f.menu.mapDraft,draft);assert.equal(f.menu.mapDialog.open,true);
  assert.equal(f.menu.mapDraftMaps.large.seed,33);assert.equal(f.menu.mapDraftMaps.large.difficulty,'hard');
});
test('one failed map shows a retry message without blocking other cards and cannot be confirmed',()=>{
  const f=fixture(true);assert.doesNotThrow(()=>f.menu.openMapDialog());
  assert.equal(f.enemies.small.children.length,2);assert.equal(f.enemies.medium.children.length,2);
  assert.match(f.statuses.large.textContent,/失败/);assert.equal(f.controls.menuMapConfirm.disabled,true);
  assert.equal(f.menu.commitMapDraft(),false);
});
test('closing before the first paint makes its pending callback harmless',()=>{
  const f=fixture();f.menu.openMapDialog();f.menu.cancelMapDraft();f.frames.shift()();assert.equal(f.renders.length,0);
});

test('a zero-size first frame can be repainted without rebuilding or rerolling any map',()=>{
  const f=fixture();f.menu.openMapDialog();f.frames.shift()();assert.equal(f.statuses.large.textContent,'正在绘制布局…');
  f.canvases.forEach(c=>{c.clientWidth=300;c.clientHeight=140;});f.menu.queueMapPreviewPaint();f.frames.shift()();
  assert.equal(f.constructs.length,3);assert.equal(f.statuses.large.textContent,'下一潜真实结构 · 出生点已标记');
});

test('a callback from a closed dialog cannot paint over a newly opened draft',()=>{
  const f=fixture();f.menu.openMapDialog();const stale=f.frames.shift();f.menu.cancelMapDraft();f.menu.openMapDialog();
  const currentFrame=f.menu.mapPreviewFrame;stale();assert.equal(f.renders.length,0);assert.equal(f.menu.mapPreviewFrame,currentFrame);
  f.canvases.forEach(c=>c.clientWidth=300);f.frames.shift()();assert.equal(f.renders.length,3);
});
