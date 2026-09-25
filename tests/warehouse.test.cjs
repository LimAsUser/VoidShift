const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sandbox = {
  window: { addEventListener() {} },
  performance: { now: () => 1000 },
  localStorage: { value: '', setItem(_key, value) { this.value = value; } },
  structuredClone
};
for (const [file, exportCode] of [
  ['js/config.js', 'globalThis.ConfigUnderTest = Config;'],
  ['js/inventory.js', 'globalThis.BackpackManagerUnderTest = BackpackManager;'],
  ['js/game.js', 'globalThis.GameUnderTest = Game;']
]) {
  vm.runInNewContext(`${fs.readFileSync(path.join(root, file), 'utf8')}\nglobalThis.__export = undefined;\n${exportCode}`, sandbox);
}

const Config = sandbox.ConfigUnderTest;
const Game = sandbox.GameUnderTest;

function makeGame(storageItems = [], storageOverflowItems = []) {
  const game = Object.create(Game.prototype);
  game.state = {
    storageItems,
    storageOverflowItems,
    storageCapacity: Config.storage?.capacityCells || 100,
    money: 1000
  };
  game.selectedStorageIds = new Set();
  game.saved = 0;
  game._save = () => { game.saved++; };
  game.updateStorageUI = () => {};
  game.updateMoneyUI = () => {};
  game.ui = { showToast() {}, formatCreditText: value => `${value} 信用点` };
  game._initializeStorage();
  return game;
}

test('warehouse defaults to a configurable 10x10 grid with 100 cells', () => {
  assert.deepEqual([Config.storage.cols, Config.storage.rows, Config.storage.capacityCells], [10, 10, 100]);
  const game = makeGame();
  assert.equal(game.storageBackpack.capacity, 100);
});

test('legacy storage keeps shaped items and moves items that do not fit into overflow', () => {
  const packed = Array.from({ length: 99 }, (_, index) => ({ name: `part-${index}`, size: 1, shape: '1x1', value: 1 }));
  const game = makeGame([...packed, { name: 'wide part', size: 1, shape: '2x1', value: 50 }]);

  assert.equal(game.storageBackpack.usedCells(), 99);
  assert.equal(game.state.storageItems.length, 99);
  assert.equal(game.state.storageOverflowItems.length, 1);
  assert.equal(game.state.storageOverflowItems[0].shape, '2x1');
  assert.equal(new Set([...game.state.storageItems, ...game.state.storageOverflowItems].map(item => item.id)).size, 100);
});

test('freed storage cells automatically accept pending items without changing their values', () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `part-${index}`, shape: '1x1', value: index }));
  const pending = { id: 101, name: 'pending', shape: '1x1', value: 777 };
  const game = makeGame(items, [pending]);

  game.storageBackpack.removeItem(1);
  game._fillStorageOverflow();

  assert.equal(game.state.storageOverflowItems.length, 0);
  assert.equal(game.storageBackpack.items.length, 100);
  assert.ok(game.state.storageItems.some(item => item.name === 'pending' && item.value === 777));
});

test('selected warehouse items can be sold in a batch while other stock remains', () => {
  const game = makeGame([
    { id: 1, name: 'one', shape: '1x1', value: 30 },
    { id: 2, name: 'two', shape: '1x1', value: 70 },
    { id: 3, name: 'three', shape: '1x1', value: 120 }
  ]);
  game.toggleStorageItemSelection(1);
  game.toggleStorageItemSelection(3);

  assert.equal(game.sellSelectedStorage(), 150);
  assert.equal(game.state.money, 1150);
  assert.equal(JSON.stringify(game.state.storageItems.map(item => item.name)), JSON.stringify(['two']));
  assert.equal(game.selectedStorageIds.size, 0);
  assert.equal(game.saved, 1);
});

test('sell all includes both the main warehouse and pending overflow without reducing capacity', () => {
  const packed = Array.from({ length: 100 }, (_, index) => ({ name: `part-${index}`, shape: '1x1', value: 2 }));
  const game = makeGame([...packed, { name: 'pending', shape: '1x1', value: 25 }]);
  const capacity = game.storageBackpack.capacity;

  assert.equal(game.sellStorage(), 225);
  assert.equal(game.state.storageItems.length, 0);
  assert.equal(game.state.storageOverflowItems.length, 0);
  assert.equal(game.state.money, 1225);
  assert.equal(game.storageBackpack.capacity, capacity);
});

test('warehouse items can be repositioned or rotated using the shared footprint rules', () => {
  const game = makeGame([
    { id: 1, name: 'elbow', shape: 'L2', value: 30, gx: 0, gy: 0, rot: 0 },
    { id: 2, name: 'cell', shape: '1x1', value: 10, gx: 5, gy: 5, rot: 0 }
  ]);
  const item = game.storageBackpack.getItem(1);

  assert.equal(game.moveStorageItem(1, 4, 2), true);
  assert.equal(game.rotateStorageItem(1), true);
  assert.equal(item.gx, 4);
  assert.equal(item.gy, 2);
  assert.equal(item.rot, 1);
});

test('keyboard rotation accepts the string ID used by the storage selection set', () => {
  const game = makeGame([{ id: 5, name: 'elbow', shape: 'L2', value: 30, gx: 0, gy: 0, rot: 0 }]);
  const item = game.storageBackpack.items[0];

  game.selectedStorageIds.add(String(item.id));
  assert.equal(game._rotateSelectedStorageItem(), true);
  assert.equal(item.rot, 1);
});

test('warehouse capacity, packed locations and overflow survive save serialization', () => {
  const fullGrid = Array.from({ length: 100 }, (_, index) => ({ name: `stored-${index}`, shape: '1x1', value: 10 }));
  const game = makeGame([...fullGrid, { name: 'pending', shape: '2x1', value: 20 }]);
  game.state.storageCapacity = 120;
  game.state.difficultyProfiles = {};
  game.state.selectedDifficulty = 'medium';
  game.state.fpsCap = '60';
  game.player = { exportArmory: () => ({}) };
  game._save = Game.prototype._save.bind(game);

  game._save();
  const saved = JSON.parse(sandbox.localStorage.value);

  assert.equal(saved.storageCapacityCells, 120);
  assert.equal(saved.storageItems[0].shape, '1x1');
  assert.ok(Number.isInteger(saved.storageItems[0].gx));
  assert.equal(saved.storageOverflowItems[0].shape, '2x1');
});
