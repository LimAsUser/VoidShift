const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test'),vm=require('node:vm');
const context={};for(const name of ['config','entities'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js',`${name}.js`),'utf8'),context);
const {Hunter,Heavy}=vm.runInNewContext('({Hunter,Heavy})',context);
test('dead Hunter and Heavy retain a three-second corpse and clear it on revival',()=>{
  const hunter=new Hunter(0,1,()=>1);hunter.active=true;
  const heavy=new Heavy(1);heavy.activate(100,100);heavy.stun(3);
  for(const enemy of [hunter,heavy]){enemy.angle=.8;enemy.registerHit();assert.equal(enemy.corpseTime,3);enemy.updateDeath(2);assert.equal(enemy.corpseTime,1);assert.equal(enemy.angle,.8);enemy.updateDeath(1);assert.equal(enemy.corpseTime,0);}
  heavy.activate(120,100);assert.equal(heavy.corpseTime,0);
});
test('a reviver returns to living art immediately when its existing revive timer ends',()=>{
  const hunter=new Hunter(0,1,()=>1);hunter.active=true;hunter.trait='reviver';hunter.registerHit();hunter.updateDeath(2);
  assert.equal(hunter.dead,false);assert.equal(hunter.corpseTime,0);
});
