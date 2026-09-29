const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sandbox = { window: { addEventListener() {} }, performance: { now: () => 1000 }, structuredClone };
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/config.js'), 'utf8')}\nglobalThis.ConfigUnderTest = Config;`, sandbox);
const managerPath = path.join(root, 'js/inventory.js');
const managerSource = fs.existsSync(managerPath) ? fs.readFileSync(managerPath, 'utf8') : '';
vm.runInNewContext(`${managerSource}\nglobalThis.BackpackManagerUnderTest = typeof BackpackManager === 'undefined' ? null : BackpackManager;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/map.js'), 'utf8')}\nglobalThis.MapManagerUnderTest = MapManager;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8')}\nglobalThis.UIManagerUnderTest = UIManager;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/game.js'), 'utf8')}\nglobalThis.GameUnderTest = Game;`, sandbox);

const BackpackManager = sandbox.BackpackManagerUnderTest;
const MapManager = sandbox.MapManagerUnderTest;
const UIManager = sandbox.UIManagerUnderTest;
const Game = sandbox.GameUnderTest;

test('generated floor scrap receives a unique stable ID for cross-player inventory ownership', () => {
  const map = new MapManager();
  const ids = map.scrap.map(item => item.id);

  assert.ok(ids.length > 0);
  assert.ok(ids.every(Number.isInteger));
  assert.equal(new Set(ids).size, ids.length);
});

test('field backpack places differently shaped items without overlap inside its 8x5 grid', () => {
  assert.equal(typeof BackpackManager, 'function', 'grid backpack manager should be available');
  const backpack = BackpackManager.fromType('field');
  const first = { id: 1, name: 'reactor-core', size: 3, shape: '2x2', value: 500 };
  const second = { id: 2, name: 'med-pack', size: 2, shape: '3x1', value: 200 };

  assert.deepEqual([backpack.cols, backpack.rows, backpack.capacity], [8, 5, 40]);
  assert.equal(backpack.place(first), true);
  assert.equal(backpack.place(second), true);
  assert.equal(backpack.usedCells(), 7);
  assert.equal(backpack.canPlace(backpack.matrixFor(second), first.gx, first.gy), false);
});

test('inventory lookup accepts the string item ID emitted by grid DOM datasets', () => {
  const manager = BackpackManager.fromType('field');
  const item = { id: 7, shape: '1x2', name: '氧气瓶' };
  assert.equal(manager.place(item), true);

  assert.equal(manager.getItem('7'), item);
});

test('value sorting compacts and orders grid items from highest to lowest recoverable value', () => {
  const backpack = new BackpackManager({ cols: 3, rows: 1, cellSize: 20, gap: 0 });
  const first = { id: 1, name: 'wide', shape: '2x1', value: 10 };
  const second = { id: 2, name: 'single', shape: '1x1', value: 20 };

  assert.equal(backpack.place(first, { gx: 0, gy: 0 }), true);
  assert.equal(backpack.place(second), true);
  const before = backpack.items.map(item => [item.id, item.gx, item.gy, item.rot]);

  const result = backpack.autoPack('value');

  assert.equal(result.failed.length, 0);
  assert.equal(JSON.stringify(backpack.items.map(item => item.id)), '[2,1]');
  assert.equal(backpack.usedCells(), 3);
  assert.notEqual(JSON.stringify(backpack.items.map(item => [item.id, item.gx, item.gy, item.rot])), JSON.stringify(before));
});

test('rotating an asymmetric item changes its footprint orientation without losing its placement', () => {
  const backpack = new BackpackManager({ cols: 4, rows: 4, cellSize: 20, gap: 0 });
  const item = { id: 3, name: 'bracket', shape: 'L2', value: 25 };

  assert.equal(backpack.place(item), true);
  assert.equal(backpack.rotateItem(item), true);
  assert.equal(item.rot, 1);
  assert.equal(backpack.canPlace(backpack.matrixFor(item), item.gx, item.gy, item.id), true);
});

test('host accepts a complete guest grid arrangement through the co-op inventory snapshot flow', () => {
  const game = Object.create(Game.prototype);
  const first = { id: 11, name: 'cable', shape: '2x1', value: 10, gx: 0, gy: 0, rot: 0 };
  const second = { id: 12, name: 'chip', shape: '1x1', value: 20, gx: 2, gy: 0, rot: 0 };
  game.state = { inventory: [], remoteInventory: [first, second] };
  game.backpack = BackpackManager.fromType('field');
  game.backpack.items = game.state.inventory;
  game.remoteBackpack = BackpackManager.fromType('field');
  game.remoteBackpack.items = game.state.remoteInventory;

  assert.equal(game._applyGuestInventoryLayout([
    { id: 11, gx: 2, gy: 0, rot: 0 },
    { id: 12, gx: 0, gy: 0, rot: 0 }
  ]), true);
  assert.equal(JSON.stringify(game.state.remoteInventory.map(item => [item.id, item.gx, item.gy])), '[[11,2,0],[12,0,0]]');
});

test('host rejects overlapping guest layout updates without altering the authoritative inventory', () => {
  const game = Object.create(Game.prototype);
  const first = { id: 21, name: 'cable', shape: '2x1', value: 10, gx: 0, gy: 0, rot: 0 };
  const second = { id: 22, name: 'chip', shape: '1x1', value: 20, gx: 2, gy: 0, rot: 0 };
  game.state = { inventory: [], remoteInventory: [first, second] };
  game.backpack = BackpackManager.fromType('field');
  game.backpack.items = game.state.inventory;
  game.remoteBackpack = BackpackManager.fromType('field');
  game.remoteBackpack.items = game.state.remoteInventory;

  assert.equal(game._applyGuestInventoryLayout([
    { id: 21, gx: 0, gy: 0, rot: 0 },
    { id: 22, gx: 0, gy: 0, rot: 0 }
  ]), false);
  assert.deepEqual(game.state.remoteInventory.map(item => [item.id, item.gx, item.gy]), [[21, 0, 0], [22, 2, 0]]);
});

test('co-op snapshots carry both players’ grid coordinates without sharing mutable item objects', () => {
  const game = Object.create(Game.prototype);
  const hostItem = { id: 41, name: 'host cargo', value: 15, gx: 1, gy: 2, rot: 1 };
  const guestItem = { id: 51, name: 'guest cargo', value: 35, gx: 4, gy: 1, rot: 2 };
  game.state = { elapsed: 2, extractionCalled: true, rescueRemaining: 12.5, rescueArrived: false,
    rescuePresent: 1, rescueRequired: 2, loot: 2, lootValue: 50, finalTerminalPressure: false,
    inventory: [hostItem], remoteInventory: [guestItem], bulletTraces: [], impactParticles: [] };
  game.player = {};
  game.remotePlayer = {};
  game._playerSnapshot = () => ({});
  game.monster = {};
  game.hunters = [];
  game.map = { doors: [], scrap: [], terminals: [] };

  const snapshot = game._createCoopSnapshot();
  hostItem.gx = 7;
  guestItem.gy = 4;

  const hostInventory = snapshot.players.find(player => player.id === 'host').inventory;
  const guestInventory = snapshot.players.find(player => player.id === 'guest').inventory;
  assert.deepEqual([hostInventory[0].gx, hostInventory[0].gy, hostInventory[0].rot], [1, 2, 1]);
  assert.deepEqual([guestInventory[0].gx, guestInventory[0].gy, guestInventory[0].rot], [4, 1, 2]);
  assert.deepEqual([snapshot.mission.rescueRemaining, snapshot.mission.rescueArrived,
    snapshot.mission.rescuePresent, snapshot.mission.rescueRequired], [12.5, false, 1, 2]);
});

test('backpack snapshot reconciliation preserves the dragged item object and applies confirmed placement', () => {
  const game = Object.create(Game.prototype);
  const draggedItem = { id: 61, name: 'guest cargo', shape: '2x1', value: 35, gx: 1, gy: 1, rot: 0 };
  game.state = { inventory: [draggedItem] };
  game.backpack = BackpackManager.fromType('field');
  game.backpack.items = game.state.inventory;

  game._reconcileBackpackSnapshot('inventory', [{ id: 61, gx: 3, gy: 2, rot: 1 }]);

  assert.equal(game.state.inventory[0], draggedItem);
  assert.deepEqual([draggedItem.gx, draggedItem.gy, draggedItem.rot], [3, 2, 1]);
});

test('guest co-op snapshots do not revert an active drag or an unconfirmed local layout', () => {
  const game = Object.create(Game.prototype);
  const item = { id: 62, name: 'guest cargo', shape: '2x1', value: 35, gx: 3, gy: 2, rot: 1 };
  game.state = { inventory: [item], remoteInventory: [] };
  game.backpack = BackpackManager.fromType('field');
  game.backpack.items = game.state.inventory;
  game.remoteBackpack = BackpackManager.fromType('field');
  game.remoteBackpack.items = game.state.remoteInventory;
  game._guestInventoryLayoutPending = false;
  game._itemDrag = { item };

  assert.equal(game._applyCoopInventorySnapshot([{ id: 62, gx: 1, gy: 1, rot: 0 }], []), false);
  assert.deepEqual([item.gx, item.gy, item.rot], [3, 2, 1]);

  game._itemDrag = null;
  game._guestInventoryLayoutPending = true;
  game._guestInventoryLayoutPendingAt = 1000;
  assert.equal(game._applyCoopInventorySnapshot([{ id: 62, gx: 1, gy: 1, rot: 0 }], []), false);
  assert.deepEqual([item.gx, item.gy, item.rot], [3, 2, 1]);

  assert.equal(game._applyCoopInventorySnapshot([{ id: 62, gx: 3, gy: 2, rot: 1 }], []), true);
  assert.equal(game._guestInventoryLayoutPending, false);
});

test('discarding a guest item restores that scrap to the facility floor and decrements mission loot', () => {
  const game = Object.create(Game.prototype);
  const item = { id: 31, name: 'cable', shape: '1x1', value: 80, gx: 0, gy: 0, rot: 0, foundThisRun: true };
  const floorItem = { ...item, x: 40, y: 60, found: true };
  game.state = { inventory: [], remoteInventory: [item], loot: 1, lootValue: 80 };
  game.remoteBackpack = BackpackManager.fromType('field');
  game.remoteBackpack.items = game.state.remoteInventory;
  game.map = { scrap: [floorItem] };
  game.remotePlayer = { x: 120, y: 140 };

  assert.equal(game._discardGuestInventoryItem({ id: 31, x: 999999, y: 999999 }), true);
  assert.equal(game.remoteBackpack.items.length, 0);
  assert.equal(floorItem.found, false);
  assert.deepEqual([floorItem.x, floorItem.y, game.state.loot, game.state.lootValue], [120, 140, 0, 0]);
});

test('host validates guest sale IDs and sends the verified payout instead of trusting a client value', () => {
  const game = Object.create(Game.prototype);
  const first = { id: 71, name: 'cable', value: 80, shape: '1x1', gx: 0, gy: 0, rot: 0 };
  const second = { id: 72, name: 'chip', value: 120, shape: '1x1', gx: 1, gy: 0, rot: 0 };
  game.state = { inventory: [], remoteInventory: [first, second], loot: 2, lootValue: 200 };
  game.remoteBackpack = BackpackManager.fromType('field');
  game.remoteBackpack.items = game.state.remoteInventory;
  const sent = [];
  game.coopSession = { sendEvent: (...args) => sent.push(args) };

  game._sellGuestInventoryItems([71, 72]);
  game._sellGuestInventoryItems([71, 72]);

  assert.equal(JSON.stringify(sent[0]), JSON.stringify(['inventory-sale-result', { accepted: true, amount: 200 }]));
  assert.equal(JSON.stringify(sent[1]), JSON.stringify(['inventory-sale-result', { accepted: false, amount: 0 }]));
});

test('guest receives sale money only after the host confirms the validated inventory sale', () => {
  const game = Object.create(Game.prototype);
  const item = { id: 81, name: 'cable', value: 80, shape: '1x1', gx: 0, gy: 0, rot: 0 };
  game.state = { inventory: [item], remoteInventory: [], money: 100, loot: 1, lootValue: 80, coop: { role: 'guest', running: true } };
  game.backpack = BackpackManager.fromType('field');
  game.backpack.items = game.state.inventory;
  game.remoteBackpack = BackpackManager.fromType('field');
  game.remoteBackpack.items = game.state.remoteInventory;
  game.player = {};
  game.selectedItemId = null;
  const sent = [];
  let saves = 0;
  game.coopSession = { sendEvent: (...args) => sent.push(args) };
  game.ui = { showToast() {}, log() {}, formatCreditText: amount => `${amount} 信用点` };
  game.updateInventoryUI = () => {};
  game.updateMoneyUI = () => {};
  game._save = () => { saves++; };

  game.sellInventory();
  assert.equal(game.state.money, 100);
  assert.equal(saves, 0);
  assert.equal(sent[0][0], 'inventory-sell');

  game._handleCoopMessage('event', { type: 'inventory-sale-result', accepted: true, amount: 80 });
  assert.equal(game.state.money, 180);
  assert.equal(saves, 1);
});

test('a pickup that cannot fit remains available on the facility floor', () => {
  const game = Object.create(Game.prototype);
  const item = { name: 'wide cable', shape: '2x1', size: 1, value: 60, x: 100, y: 100, found: false };
  game.state = { running: true, tutorial: null, inventory: [], remoteInventory: [], loot: 0, lootValue: 0 };
  game.player = { x: 100, y: 100, noise: 0 };
  game.remotePlayer = null;
  game.backpack = new BackpackManager({ cols: 1, rows: 1, cellSize: 20, gap: 0 });
  game.remoteBackpack = BackpackManager.fromType('field');
  game.state.inventory = game.backpack.items;
  game.state.remoteInventory = game.remoteBackpack.items;
  game.map = { scrap: [item] };
  game.ui = { showToast() {}, log() {} };

  game.collect();

  assert.equal(item.found, false);
  assert.equal(game.state.inventory.length, 0);
  assert.equal(game.state.loot, 0);
});

test('a successful pickup stores the floor item in the local grid and carries its footprint data', () => {
  const game = Object.create(Game.prototype);
  const item = { name: 'reactor cable', shape: '2x1', size: 1, value: 60, x: 100, y: 100, found: false };
  game.state = { running: true, tutorial: null, inventory: [], remoteInventory: [], loot: 0, lootValue: 0, coop: { role: null, running: false } };
  game.player = { x: 100, y: 100, noise: 0 };
  game.remotePlayer = null;
  game.backpack = BackpackManager.fromType('field');
  game.remoteBackpack = BackpackManager.fromType('field');
  game.state.inventory = game.backpack.items;
  game.state.remoteInventory = game.remoteBackpack.items;
  game.map = { scrap: [item] };
  game.ui = { showToast() {}, log() {} };
  game._tutorialAction = () => {};
  game.updateInventoryUI = () => {};

  game.collect();

  assert.equal(item.found, true);
  assert.equal(game.state.inventory[0], item);
  assert.ok(Number.isInteger(item.gx) && Number.isInteger(item.gy) && Number.isInteger(item.rot));
  assert.deepEqual([game.state.loot, game.state.lootValue, game.player.noise], [1, 60, 5]);
});

test('discarding a carried prep item puts it on the floor without changing this dive salvage counters', () => {
  const item = { id: 'carry:old-3', name: '备用氧气瓶', shape: '1x2', value: 250, foundThisRun: false };
  const game = Object.create(Game.prototype);
  game.backpack = BackpackManager.fromType('field');
  game.backpack.place(item);
  game.state = { inventory: game.backpack.items, loot: 2, lootValue: 80, coop: { role: null, running: false } };
  game.player = { x: 50, y: 60 };
  game.map = { scrap: [] };
  game.selectedItemId = item.id;
  game.ui = { showToast() {}, log() {} };
  game.updateInventoryUI = () => {};
  game._syncGuestInventoryLayout = () => {};

  assert.equal(game.discardItem(), true);
  assert.equal(game.map.scrap.length, 1);
  assert.equal(game.state.loot, 2);
  assert.equal(game.state.lootValue, 80);
});

test('rendered backpack blocks receive pointer input for selection and drag', () => {
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.attributes = {};
      this.style = { setProperty() {} };
      this.dataset = {};
      this.children = [];
      this.listeners = {};
      this.className = '';
      this.classList = { toggle() {}, add() {}, remove() {} };
    }
    set innerHTML(_value) { this.children = []; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    appendChild(child) { this.children.push(child); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    querySelectorAll(selector) {
      if (selector === '.bp-cell') return this.children.filter(child => child.className === 'bp-cell');
      if (selector === '.bp-item') return this.children.filter(child => child.className.includes('bp-item'));
      return [];
    }
  }

  const ids = new Map(['inventoryGrid', 'inventoryTitle', 'inventoryCount', 'inventoryCapacity', 'itemDesc', 'rotateItemBtn', 'discardItemBtn']
    .map(id => [id, new FakeElement()]));
  const previousDocument = sandbox.document;
  sandbox.document = {
    getElementById: id => ids.get(id),
    createElement: tagName => new FakeElement(tagName),
    createElementNS: (_namespace, tagName) => new FakeElement(tagName)
  };
  try {
    const game = Object.create(Game.prototype);
    game.state = { inventory: [], remoteInventory: [], inventoryOpen: true };
    game.player = {};
    game.remotePlayer = null;
    game.backpack = BackpackManager.fromType('field');
    game.remoteBackpack = BackpackManager.fromType('field');
    game.state.inventory = game.backpack.items;
    game.state.remoteInventory = game.remoteBackpack.items;
    game.ui = Object.create(UIManager.prototype);
    game.backpack.place({ id: 91, name: 'test item', shape: '1x1', value: 10 });
    game.selectedItemId = null;

    game.updateInventoryUI();

    const grid = ids.get('inventoryGrid');
    assert.ok(grid);
    const tile = grid.children.find(child => child.className.includes('bp-item'));
    assert.ok(tile);
    const block = tile.children.find(child => child.className === 'bp-block');
    assert.equal(block.style.pointerEvents, 'auto');
    assert.equal(typeof block.listeners.pointerdown, 'function');
    assert.equal(typeof block.listeners.contextmenu, 'function');
    const price = tile.children.find(child => child.className === 'menu-item-price');
    const currencyImage = price.children[0];
    assert.equal(currencyImage.tagName, 'img');
    assert.equal(currencyImage.attributes.src, 'resources/images/voidshift-credit-coin.png');
    assert.equal(price.children[1].textContent, '10');
  } finally {
    if (previousDocument === undefined) delete sandbox.document;
    else sandbox.document = previousDocument;
  }
});
