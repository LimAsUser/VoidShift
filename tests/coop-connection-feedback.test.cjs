const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
function node(){return {textContent:'',value:'',children:[],style:{},dataset:{},classList:{toggle(){}},setAttribute(){},addEventListener(){},focus(){this.focused=true;},select(){this.selected=true;},append(...nodes){this.children.push(...nodes);},appendChild(child){this.children.push(child);},replaceChildren(...nodes){this.children=nodes;}};}
function setup(){
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const context=vm.createContext({window:{addEventListener(){}},document:{getElementById:get,querySelector:get,createElement:node},navigator:{clipboard:{writeText:async()=>{throw new Error('denied');}}},clearTimeout(){},performance:{now:()=>1000},EventTarget,CustomEvent});
  for(const f of ['config','game','ui','menu'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f+'.js'),'utf8'),context);
  const classes=vm.runInContext('({Game,UIManager,SafehouseMenu})',context);
  const ui=new Proxy({}, {get(target,key){return target[key] ||= node();}});
  return {...classes,ui,get,context};
}

test('failed connection offers retry/cancel/diagnostics and preserves its actual failed stage',()=>{
  const h=setup();h.UIManager.prototype.updateCoopLobby.call(h.ui,{role:'guest',members:[],connected:false,connectionPhase:'failed',connectionMessage:'上传连接回应：网络请求失败',canRetryConnection:true,diagnosticsAvailable:true});
  assert.equal(h.ui.coopConnectionFeedback.hidden,false);assert.match(h.ui.coopConnectionMessage.textContent,/上传连接回应/);
  assert.equal(h.ui.coopRetryButton.hidden,false);assert.equal(h.ui.coopRetryButton.disabled,false);
  assert.equal(h.ui.coopCancelConnectionButton.hidden,false);assert.equal(h.ui.coopReadyButton.disabled,true);
});

test('host sees only its own knowledge of a peer failure, not an invented remote browser cause',()=>{
  const h=setup();h.UIManager.prototype.updateCoopLobby.call(h.ui,{role:'host',members:[{id:'g',slot:2,connected:false,status:'offline',connectionPhase:'failed',connectionMessage:'等待队友回应：连接超时'}]});
  const seat=h.ui.coopMembersList.children[0];assert.match(seat.children[2].textContent,/等待队友回应/);assert.doesNotMatch(seat.children[2].textContent,/广告|防火墙|Edge/);
});

test('guest host card never says connected while the transport is still pending',()=>{
  const h=setup(),menu=Object.create(h.SafehouseMenu.prototype);
  menu.game={state:{coop:{role:'guest',members:[],connected:false}},ui:{startButton:node()},player:{armory:{loadout:{}}},getMenuPreviewMap:()=>null};menu.tab='loadout';
  menu.updateLobby();assert.doesNotMatch(h.get('.coop-host-seat > p').textContent,/已连接/);
});

test('failed initial join retains its known seat and explicit retry reuses the session',async()=>{
  const h=setup(),game=Object.create(h.Game.prototype);let closed=0,retried=0;
  game.state={running:false,coop:{role:null,members:[]}};game.ui={coopJoinCode:{value:'ABC234'},showToast(){}};game.updateCoopUI=()=>{};
  game.coopSession={role:'guest',roomCode:'ABC234',memberId:'g',localSlot:2,canRetryJoin:true,
    connectionStatus:{phase:'failed',stage:'upload-answer',message:'网络请求失败'},
    join:async()=>{throw new Error('网络请求失败');},retryJoin:async()=>{retried++;},close(){closed++;}};
  await game.joinCoopRoom();assert.equal(closed,0);assert.equal(game.state.coop.role,'guest');assert.equal(game.state.coop.playerId,'g');
  await game.retryCoopConnection();assert.equal(retried,1);assert.ok(!game.state.coop.roomPending);
});

test('clipboard denial exposes selectable diagnostic text without losing the report',async()=>{
  const h=setup(),game=Object.create(h.Game.prototype),ui=Object.create(h.UIManager.prototype);
  ui.coopDiagnosticsText=node();ui.coopConnectionFeedback=node();ui.showToast=()=>{};game.ui=ui;
  game.coopSession={getConnectionDiagnostics:()=>'{"protocol":15,"records":[]}'};
  await game.copyCoopDiagnostics();assert.equal(ui.coopDiagnosticsText.hidden,false);assert.equal(ui.coopDiagnosticsText.selected,true);
  assert.equal(ui.coopDiagnosticsText.value,'{"protocol":15,"records":[]}');
});

test('connection stage and member errors reach the existing game lobby',()=>{
  const h=setup(),game=Object.create(h.Game.prototype);game.state={coop:{role:'host',members:[]}};game.coopSession=new EventTarget();game.coopSession.peers=new Map();game.updateCoopUI=()=>{};
  game._attachCoopSession();game.coopSession.dispatchEvent(new CustomEvent('connection-stage',{detail:{peerId:'g',slot:2,generation:0,stage:'answer-wait',phase:'failed',message:'等待队友回应超时'}}));
  assert.equal(game.state.coop.members[0]?.connectionPhase,'failed');
  game.coopSession.dispatchEvent(new CustomEvent('member-error',{detail:{memberId:'h',slot:3,generation:0,error:new Error('建立数据通道失败')}}));
  assert.equal(game.state.coop.members.find(m=>m.id==='h')?.connectionPhase,'failed');
});

test('expiry in the safehouse leaves the room without settling a mission or assets',()=>{
  const h=setup(),game=Object.create(h.Game.prototype);let finished=0;
  game.state={running:false,coop:{role:'guest',playerId:'g',running:false,members:[]}};
  game.coopSession={close(){}};game.ui={setCoopPaused(){}};game.updateCoopUI=()=>{};game.finish=()=>finished++;
  game._removeCoopMember('g');assert.equal(finished,0);assert.equal(game.state.coop.role,null);
});
