const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const saved = { value: null };
const sandbox = {
  window: { addEventListener() {} },
  localStorage: {
    getItem() { return saved.value; },
    setItem(_key, value) { saved.value = value; }
  },
  structuredClone,
  performance: { now: () => 1000 }
};
for (const [file, exportCode] of [
  ['js/config.js', 'globalThis.ConfigUnderTest = Config;'],
  ['js/rewards.js', ''],
  ['js/inventory.js', 'globalThis.BackpackManagerUnderTest = BackpackManager;'],
  ['js/entities.js', 'globalThis.PlayerUnderTest = Player;'],
  ['js/game.js', 'globalThis.GameUnderTest = Game;']
]) {
  vm.runInNewContext(`${fs.readFileSync(path.join(root, file), 'utf8')}\n${exportCode}`, sandbox);
}

const Config = sandbox.ConfigUnderTest;
const BackpackManager = sandbox.BackpackManagerUnderTest;
const Player = sandbox.PlayerUnderTest;
const Game = sandbox.GameUnderTest;

function makeGame({ money = 1000, oxygen = 50, items = [], running = false } = {}) {
  const game = Object.create(Game.prototype);
  game.state = {
    money, inventory: items, running, tutorial: null,
    coop: { role: null, running: false, playerId: 'host' }
  };
  game.backpack = BackpackManager.fromType('field');
  game.storageBackpack = new BackpackManager(Config.storage);
  game.backpack.items = items;
  game.player = { oxygen, downed: false };
  game.selectedItemId = items[0]?.id ?? null;
  game.ui = { showToast() {}, formatCreditText: value => `${value} 信用点` };
  game._save = () => {};
  game.updateMoneyUI = () => {};
  game.updateAmmoDepotUI = () => {};
  game.updateInventoryUI = () => {};
  game.updateStorageUI = () => {};
  return game;
}

test('oxygen canister is a 1x2 consumable with a half-price resale value', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(Config.consumables.oxygenCanister)), {
    id: 'oxygen-canister', name: '备用氧气瓶', shape: '1x2', purchasePrice: 300,
    value: 150, effect: 'oxygen-50', image: 'resources/images/oxygen-canister.png'
  });
});

test('buying an oxygen canister charges 300 and places it in the next-dive backpack', () => {
  const game = makeGame({ money: 300 });

  assert.equal(game.purchaseOxygenCanister(), true);
  assert.equal(game.state.money, 0);
  assert.equal(game.backpack.items.length, 1);
  assert.equal(game.backpack.items[0].shape, '1x2');
  assert.equal(game.backpack.sizeFor(game.backpack.items[0]).h, 2);
});

test('multiple purchased oxygen canisters receive distinct inventory IDs', () => {
  const game = makeGame({ money: 1000 });

  assert.equal(game.purchaseOxygenCanister(), true);
  assert.equal(game.purchaseOxygenCanister(), true);
  assert.equal(new Set(game.backpack.items.map(item => item.id)).size, 2);
});

test('full backpack and warehouse reject the oxygen purchase without charging', () => {
  const manager = BackpackManager.fromType('field');
  for (let index = 0; index < manager.capacity; index++) {
    assert.equal(manager.place({ id: index + 1, shape: '1x1', name: `cell-${index}`, value: 1 }), true);
  }
  const game = makeGame({ money: 500, items: manager.items });
  game.backpack = manager;
  game.storageBackpack = new BackpackManager(1, 1);

  assert.equal(game.purchaseOxygenCanister(), false);
  assert.equal(game.state.money, 500);
  assert.equal(game.backpack.items.length, 40);
});

test('using an oxygen canister restores 50 points up to 100 and consumes it once', () => {
  const game = makeGame({ oxygen: 65, running: true, items: [
    { id: 4, type: 'consumable', effect: 'oxygen-50', shape: '1x2', value: 250, gx: 0, gy: 0, rot: 0 }
  ] });
  game.selectedItemId = '4';

  assert.equal(game.useSelectedInventoryItem(), true);
  assert.equal(game.player.oxygen, 100);
  assert.equal(game.backpack.items.length, 0);
  assert.equal(game.useSelectedInventoryItem(), false);
});

test('oxygen canisters cannot be consumed at full oxygen or while downed', () => {
  for (const player of [{ oxygen: 100, downed: false }, { oxygen: 20, downed: true }]) {
    const game = makeGame({ running: true, items: [
      { id: 9, type: 'consumable', effect: 'oxygen-50', shape: '1x2', value: 250, gx: 0, gy: 0, rot: 0 }
    ] });
    game.player = player;
    game.selectedItemId = 9;

    assert.equal(game.useSelectedInventoryItem(), false);
    assert.equal(game.backpack.items.length, 1);
  }
});

test('the saved next-dive backpack round-trips without changing legacy cargo or credits', () => {
  saved.value = JSON.stringify({
    money: 725,
    storageItems: [{ id: 1, shape: '1x1', value: 35, gx: 0, gy: 0 }],
    backpackItems: [{ id: 2, shape: '1x2', type: 'consumable', effect: 'oxygen-50', value: 250, gx: 1, gy: 0, rot: 0 }]
  });
  const game = Object.create(Game.prototype);
  game.state = { money: 1000, inventory: [], storageItems: [], storageOverflowItems: [], storageCapacity: 100, selectedDifficulty: 'medium', fpsCap: '60' };
  game.player = new Player();
  game.backpack = BackpackManager.fromType('field');
  game._loadSave();
  game._bindBackpackInventories();
  game._save();
  const record = JSON.parse(saved.value);

  assert.equal(game.state.money, 725);
  assert.equal(game.state.storageItems[0].value, 35);
  assert.equal(record.backpackItems[0].shape, '1x2');
  assert.equal(record.backpackItems[0].value, 150);
});

test('items carried across dives receive stable IDs that cannot alias new floor scrap', () => {
  const game = Object.create(Game.prototype);
  const carried = game._namespacePersistentBackpackItems([
    { id: 7, name: '旧物资' },
    { id: 'supply-oxygen-1', name: '备用氧气瓶' }
  ]);

  assert.deepEqual(carried.map(item => item.id), ['carry:7', 'carry:supply-oxygen-1']);
  assert.deepEqual(game._namespacePersistentBackpackItems(carried).map(item => item.id), ['carry:7', 'carry:supply-oxygen-1']);
});
