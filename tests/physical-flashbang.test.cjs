const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test'),vm=require('node:vm');
let saved=null;
const sandbox={window:{addEventListener(){}},structuredClone,performance:{now:()=>1000},localStorage:{getItem:()=>saved,setItem:(_k,v)=>{saved=v;}}};
for(const file of ['config','inventory','entities','game'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js',`${file}.js`),'utf8'),sandbox);
const {Game,Player,BackpackManager,Config}=vm.runInNewContext('({Game,Player,BackpackManager,Config})',sandbox);
function game(){const g=Object.create(Game.prototype);g.state={money:8000,running:false,elapsed:0,coop:{},inventory:[],remoteInventory:[],storageItems:[],storageOverflowItems:[],storageCapacity:100};
g.player=new Player();g.backpack=BackpackManager.fromType('field');g.remoteBackpack=BackpackManager.fromType('field');g.remotePlayers=new Map();g._bindBackpackInventories();g._initializeStorage();
g.ui={showToast(){},updateSkillReadout(){},formatCreditText:n=>String(n)};g.updateMoneyUI=g.updateStorageUI=g.updateLoadoutUI=g.updateInventoryUI=g._syncPreparedBackpack=g._notifyTransaction=g._tutorialAction=()=>{};return g;}
function fill(manager){while(manager.place({shape:'1x1',name:'cargo',value:1})){}}
test('flashbang unlock needs no inventory space, never auto-equips and cannot be purchased twice',()=>{
const g=game();fill(g.backpack);fill(g.storageBackpack);
const bagCount=g.backpack.items.length,storageCount=g.storageBackpack.items.length,before=g.state.money;
assert.equal(g.purchaseAbility('skill','flashbang'),true);assert.equal(g.state.money,before-Config.skills.flashbang.price);
assert.equal(g.player.armory.ownedSkills.flashbang,true);assert.equal(g.player.armory.equippedSkill,null);
assert.equal(g.backpack.items.length,bagCount);assert.equal(g.storageBackpack.items.length,storageCount);
assert.equal(g.purchaseAbility('skill','flashbang'),false);assert.equal(g.state.money,before-Config.skills.flashbang.price);
});

function controls(skill='flashbang') {
  const g=game(),listeners=new Map();
  const node={addEventListener(){}};
  sandbox.window.addEventListener=(name,handler)=>{
    if(!listeners.has(name))listeners.set(name,[]);
    listeners.get(name).push(handler);
  };
  sandbox.document={addEventListener(){},getElementById:()=>node};
  Object.assign(g.ui,{startButton:node,prompt:node,settingsSectionButtons:[],difficultyButtons:{},hunterSettingInputs:[],finalTerminalSettingInputs:{}});
  g.audio={ensureAudio(){}};
  assert.equal(g.purchaseAbility('skill',skill),true);
  assert.equal(g.player.armory.equippedSkill,null);
  assert.equal(g.equipAbility('skill',skill),true);
  g.backpack.place({shape:'1x1',name:'cargo',value:1});
  Object.assign(g.state,{running:true,keys:{},mouseX:400,mouseY:400,flashbangs:[]});
  g.map={seed:1};
  g.attachEventListeners();
  return {g,press(key,repeat=false){
    for(const handler of listeners.get('keydown'))handler({key,repeat,preventDefault(){}});
  }};
}

test('F toggles the flashlight once per press without using the skill; G is unbound',()=>{
  const {g,press}=controls();
  g.player.flashlight=true;
  press('F');assert.equal(g.player.flashlight,false);
  press('f',true);assert.equal(g.player.flashlight,false);
  press('g');assert.equal(g.player.flashlight,false);
  assert.equal(g.backpack.items.length,1);assert.equal(g.player.skillReadyAt,0);
  assert.equal(g.state.flashbangs.length,0);
  press('f');assert.equal(g.player.flashlight,true);
});

test('T uses the selected skill once per press and respects cooldown without consuming cargo',()=>{
  for(const skill of ['flashbang','grenade']){
    const {g,press}=controls(skill);g.player.flashlight=true;
    press('T');assert.equal(g.backpack.items.length,1);assert.equal(g.state.flashbangs.length,1);
    assert.equal(g.state.flashbangs[0].skillId,skill);assert.equal(g.player.skillReadyAt,Config.skills[skill].cooldown);
    press('t');assert.equal(g.state.flashbangs.length,1,'a fresh press cannot bypass cooldown');
    g.state.elapsed=Config.skills[skill].cooldown;
    press('t',true);assert.equal(g.state.flashbangs.length,1,'holding T never repeats when cooldown expires');
    press('t');assert.equal(g.backpack.items.length,1);assert.equal(g.state.flashbangs.length,2);
    assert.equal(g.player.skillReadyAt,Config.skills[skill].cooldown*2);assert.equal(g.player.flashlight,true);
  }
});

test('paused guidance, menus, backpack, transition and flash stun block F/T actions',()=>{
  for(const state of [{pauseMenuOpen:true},{inventoryOpen:true},{tutorial:{paused:true}},
    {transitioning:true},{coop:{running:true,hostPaused:true}},{running:false},{flashStunned:true}]){
    const {g,press}=controls();Object.assign(g.state,state);g.player.flashlight=true;
    if(state.flashStunned)g.player.flashStunTimer=5;
    press('f');press('t');
    assert.equal(g.player.flashlight,true,JSON.stringify(state));
    assert.equal(g.backpack.items.length,1,JSON.stringify(state));
    assert.equal(g.player.skillReadyAt,0,JSON.stringify(state));
    assert.equal(g.state.flashbangs.length,0,JSON.stringify(state));
  }
});

test('tutorial practice records F as flashlight and T as the selected active skill',()=>{
  const {g,press}=controls();
  g._tutorialAction=Game.prototype._tutorialAction;
  g.state.tutorial={paused:false,step:0,progress:{},steps:[{actions:['flashlight','skill','move']}]};
  press('g');assert.deepEqual(Object.keys(g.state.tutorial.progress),[]);
  press('f');assert.equal(g.state.tutorial.progress.flashlight,true);
  assert.equal(g.state.tutorial.progress.skill,undefined);
  press('t');assert.equal(g.state.tutorial.progress.skill,true);
});

test('guest T requests a host-authoritative skill once without local cooldown or projectile',()=>{
  const {g,press}=controls(),sent=[];
  g.state.coop={running:true,role:'guest'};
  g.coopSession={sendEvent(...args){sent.push(args);return true;}};
  press('t');press('t',true);press('t');
  assert.equal(sent.length,1);
  assert.equal(sent[0][0],'action');assert.equal(sent[0][1].action,'use-skill');
  assert.equal(sent[0][1].requestId,1);
  assert.equal(sent[0][1].targetX,400);assert.equal(sent[0][1].targetY,400);
  assert.equal(g.backpack.items.length,1);assert.equal(g.state.flashbangs.length,0);assert.equal(g.player.skillReadyAt,0);
});
