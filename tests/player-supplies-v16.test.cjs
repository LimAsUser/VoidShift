const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const sandbox={window:{addEventListener(){}},structuredClone,performance};
for(const file of ['config','inventory','entities','game'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js',`${file}.js`),'utf8'),sandbox);
const {Game,Player,BackpackManager,Config}=vm.runInNewContext('({Game,Player,BackpackManager,Config})',sandbox);
function game(){const g=Object.create(Game.prototype);g.state={running:false,elapsed:0,money:1000,coop:{},inventory:[],storageItems:[],storageOverflowItems:[]};g.player={health:50,oxygen:50};g.backpack=BackpackManager.fromType('field');g.storageBackpack=new BackpackManager(Config.storage);g.ui={showToast(){}};g._save=g.updateMoneyUI=g.updateAmmoDepotUI=g.updateStorageUI=g.updateInventoryUI=g._syncPreparedBackpack=g._notifyTransaction=()=>{};return g;}
test('supplies cost 300, fall back to warehouse, and full storage refuses without charging',()=>{
  const g=game();g.backpack=new BackpackManager(1,1);assert.equal(g.purchaseOxygenCanister(),true);
  assert.equal(g.state.money,700);assert.equal(g.storageBackpack.items.length,1);assert.equal(g.storageBackpack.items[0].value,150);
  assert.equal(typeof g.purchaseMedkit,'function');assert.equal(g.purchaseMedkit(),true);assert.equal(g.state.money,400);
  g.storageBackpack=new BackpackManager(1,1);assert.equal(g.purchaseMedkit(),false);assert.equal(g.state.money,400);
});
test('H uses only carried medkits, caps HP and duplicate/blocked uses never consume',()=>{
  const g=game();g.state.running=true;g.backpack.items=[{id:'med1',effect:'health-40'},{id:'med2',effect:'health-40'}];
  assert.equal(g.useQuickItem('health-40'),true);assert.equal(g.player.health,50);
  g.state.elapsed=2;g._updateSupplyUses();assert.equal(g.player.health,90);
  assert.equal(g.useQuickItem('health-40'),true);g.state.elapsed=4;g._updateSupplyUses();assert.equal(g.player.health,100);assert.equal(g.backpack.items.length,0);
  g.backpack.items=[{id:'full',effect:'health-40'}];assert.equal(g.useQuickItem('health-40'),false);assert.equal(g.backpack.items.length,1);
  g.player.health=20;g.player.stunned=1;assert.equal(g.useQuickItem('health-40'),false);assert.equal(g.backpack.items.length,1);
  g.player.stunned=0;g.state.coop={running:true,role:'guest'};const actions=[];g.coopSession={sendEvent:(type,data)=>{actions.push(data);return true;}};
  assert.equal(g.useQuickItem('health-40'),true);assert.equal(actions[0].itemId,'full');assert.equal(g.player.health,20);
});
test('easy pistol fires and reloads a six-round virtual magazine without changing stored ammo',()=>{
  const p=new Player();assert.equal(typeof p.setMissionAmmoRules,'function');
  p.armory.weaponAmmo.pistol={magazine:2,reserve:3};const before=JSON.stringify(p.exportArmory());p.setMissionAmmoRules('easy');
  for(let cycle=0;cycle<3;cycle++){
    for(let i=0;i<6;i++){p.shootCooldown=0;assert.equal(p.shoot(true,null,null,null).fired,true);}
    assert.equal(p.ammo,0);assert.equal(p.reload(null),true);p._updateReload(2,{});assert.equal(p.ammo,6);
  }
  assert.equal(JSON.stringify(p.exportArmory()),before);p.setMissionAmmoRules(null);assert.equal(p.ammo,2);assert.equal(p.reserveAmmo,3);
});
