const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sandbox = { window: { addEventListener() {} }, structuredClone, performance, console };
for (const name of ['config', 'inventory', 'entities', 'equipment', 'game']) {
  const file = path.join(__dirname, '../js', name + '.js');
  if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
}
const { Game, Player, BackpackManager } = vm.runInNewContext('({Game, Player, BackpackManager})', sandbox);
function fixture() {
  const g = Object.create(Game.prototype);
  g.state = { running: true, elapsed: 0, missionFxId: 'test-mission', coop: {}, inventory: [], keys: {} };
  g.player = new Player(); g.player.health = 50; g.player.oxygen = 40;
  g.backpack = BackpackManager.fromType('field'); g.remotePlayers = new Map();
  g.ui = { showToast() {} }; g.audio = {}; g._save = g.updateInventoryUI = g._tutorialAction = () => {};
  return g;
}
test('medical use keeps item and HP until two mission seconds then consumes once', () => {
  const g = fixture(); g.backpack.items = [{id: 'med', effect: 'health-40'}];
  assert.equal(g._useCarriedSupply(g.player, 'med'), true);
  assert.equal(g.player.health, 50); assert.equal(g.backpack.items.length, 1);
  assert.equal(g._useCarriedSupply(g.player, 'med'), false);
  g.state.elapsed = 1.99; g._updateSupplyUses(); assert.equal(g.player.health, 50);
  g.state.elapsed = 2; g._updateSupplyUses(); g._updateSupplyUses();
  assert.equal(g.player.health, 90); assert.equal(g.backpack.items.length, 0);
});
test('ordinary damage does not cancel use but stun does without consuming', () => {
  const g = fixture(); g.backpack.items = [{id: 'o2', effect: 'oxygen-50'}];
  g._useCarriedSupply(g.player, 'o2'); g._applyDamage(g.player, 5);
  assert.ok(g.player.supplyUse); g.player.stunned = 1;
  g.state.elapsed = 2; g._updateSupplyUses();
  assert.equal(g.player.oxygen, 40); assert.equal(g.backpack.items.length, 1); assert.equal(g.player.supplyUse, null);
});
test('shield removes attack damage, keeps control, and starts fifty-second cooldown', () => {
  const g = fixture(); g.player.armory.equippedPassive = 'shield'; g.player.armory.ownedPassives.shield = true;
  const result = g._applyDamage(g.player, 10, 4, 2);
  assert.equal(result.blocked, false); assert.equal(result.shielded, true);
  assert.equal(g.player.health, 50); assert.equal(g.player.oxygen, 40); assert.equal(g.player.stunned, 2);
  assert.equal(g.player.shieldReadyAt, 50); assert.equal(g.player.shieldUntil, 3);
  g.state.elapsed = 3.1; g._applyDamage(g.player, 10); assert.equal(g.player.health, 40);
  g.state.elapsed = 50; g._applyDamage(g.player, 10); assert.equal(g.player.health, 40);
});
test('roll immunity does not consume emergency shield', () => {
  const g = fixture(); g.player.armory.equippedPassive = 'shield'; g.player.armory.ownedPassives.shield = true;
  g.player.dodgeTimer = 0.3; assert.equal(g._applyDamage(g.player, 10).blocked, true);
  assert.equal(g.player.shieldReadyAt || 0, 0);
});
