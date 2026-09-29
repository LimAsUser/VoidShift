const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test'),vm=require('node:vm');
const sandbox={window:{addEventListener(){}},structuredClone};
for(const file of ['config','inventory','entities','game'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js',`${file}.js`),'utf8'),sandbox);
const {Game,BackpackManager}=vm.runInNewContext('({Game,BackpackManager})',sandbox);
function game(){const g=Object.create(Game.prototype);g.state={running:true,coop:{running:false},inventory:[]};g.player={oxygen:10,downed:false};g.backpack=BackpackManager.fromType('field');g.ui={showToast(){}};g._save=g.updateInventoryUI=()=>{};return g;}
test('C automatically consumes unbound bottles one at a time then uses the next',()=>{
  const g=game();g.backpack.items=[{id:'first',effect:'oxygen-50'},{id:'second',effect:'oxygen-50',quickUse:true}];
  assert.equal(g.useQuickItem(),true);assert.equal(g.player.oxygen,60);
  assert.deepEqual(g.backpack.items.map(x=>x.id),['second']);
  assert.equal(g.useQuickItem(),true);assert.equal(g.player.oxygen,100);assert.equal(g.backpack.items.length,0);
});
test('C never uses warehouse stock and respects full oxygen, stun, roll and modal restrictions',()=>{
  const g=game();g.storageBackpack={items:[{id:'stored',effect:'oxygen-50'}]};assert.equal(g.useQuickItem(),false);
  g.backpack.items=[{id:'bag',effect:'oxygen-50'}];
  for(const [field,value] of [['oxygen',100],['downed',true],['stunned',1],['flashStunTimer',1],['dodgeTimer',.2]]){
    const before=g.player[field];g.player[field]=value;assert.equal(g.useQuickItem(),false,field);g.player[field]=before;
  }
  g.state.inventoryClosing=true;assert.equal(g.useQuickItem(),false);assert.equal(g.backpack.items.length,1);
});
test('Guest C sends the actual carried item ID and does not consume or heal locally',()=>{
  const g=game();g.state.coop={running:true,role:'guest'};g.backpack.items=[{id:'carry:1',effect:'oxygen-50'}];const requests=[];
  g.coopSession={sendEvent:(...args)=>{requests.push(args);return true;}};
  assert.equal(g.useQuickItem(),true);assert.equal(requests[0][1].itemId,'carry:1');
  assert.equal(g.backpack.items.length,1);assert.equal(g.player.oxygen,10);
});
