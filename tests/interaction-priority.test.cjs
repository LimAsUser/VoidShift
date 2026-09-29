const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const sandbox = {
  window: { addEventListener() {} },
  structuredClone,
  performance: { now: () => 1000 }
};
for (const [file, exportCode] of [
  ['js/config.js', 'globalThis.ConfigUnderTest = Config;'],
  ['js/inventory.js', 'globalThis.BackpackManagerUnderTest = BackpackManager;'],
  ['js/entities.js', 'globalThis.PlayerUnderTest = Player;'],
  ['js/game.js', 'globalThis.GameUnderTest = Game;']
]) {
  vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', file), 'utf8')}\n${exportCode}`, sandbox);
}

const BackpackManager = sandbox.BackpackManagerUnderTest;
const Game = sandbox.GameUnderTest;

test('Monster relocation follows an open corridor passage rather than an unrelated nearer room', () => {
  const current = { center: { x: 0, y: 0 }, doors: [] };
  const adjacent = { center: { x: 400, y: 0 }, title: 'Linked corridor', label: 'LINK' };
  const separated = { center: { x: 0, y: 40 }, title: 'Behind a wall', label: 'WALL' };
  current.doors.push({ roomA: current, roomB: adjacent, isPassage: true, open: true });
  const game = Object.create(Game.prototype);
  game.state = { qteMonsterTpCooldown: 0 };
  game.player = { x: 0, y: 0, angle: 0 };
  game.map = { enemyTypes: ['monster'], doors: [], passages: current.doors, worldRooms: [current, separated, adjacent], getRoomAt: () => current };
  game.monster = {};
  game.audio = { playTone() {} };
  game.ui = { log() {}, showToast() {} };
  assert.equal(game.teleportMonsterToNearbyRoom(false), true);
  assert.deepEqual([game.monster.x, game.monster.y], [400, 0]);
});

test('a nearby salvage item is collected before an overlapping airlock or evacuation interaction', () => {
  const item = { id: 4, x: 100, y: 100, found: false, shape: '1x1', name: '测试物资', value: 30 };
  const map = {
    doors: [{ x: 90, y: 90, w: 20, h: 20, axis: 'h', open: false, targetOpen: false }], terminals: [], scrap: [item],
    extractionPoint: { x: 110, y: 100 }, exitExtractionPoint: { x: 110, y: 100 }
  };
  map.toggleDoor = () => { map.doorUsed = true; return { open: true, dir: 1 }; };
  const game = Object.create(Game.prototype);
  game.state = {
    running: true, tutorial: null, extractionCalled: false,
    loot: 0, lootValue: 0, coop: { running: false, hostPaused: false }
  };
  game.player = { x: 100, y: 100, noise: 0, dodgeTimer: 0, stunned: 0, downed: false };
  game.map = map;
  game.backpack = BackpackManager.fromType('field');
  game.state.inventory = game.backpack.items;
  game._backpackFor = () => game.backpack;
  game.updateInventoryUI = () => {};
  game.callExtraction = () => { game.state.extractionCalled = true; };
  game.ui = { showToast() {}, log() {} };
  game.audio = { playTone() {} };
  game._tutorialAction = () => {};

  game.interact();

  assert.equal(item.found, true);
  assert.equal(map.doorUsed, undefined);
  assert.equal(game.state.loot, 1);
  assert.equal(game.state.extractionCalled, false);
});

test('after all terminals, E at the far evac pod takes priority over a nearby door', () => {
  const map = {
    doors: [{ x: 490, y: 490, w: 20, h: 20, axis: 'h', open: false, targetOpen: false }],
    terminals: [{ solved: true }], scrap: [], windows: [],
    extractionPoint: { x: 100, y: 100 }, exitExtractionPoint: { x: 500, y: 500 },
    toggleDoor() { this.doorUsed = true; return { open: true, dir: 1 }; }
  };
  const game = Object.create(Game.prototype);
  game.state = { running: true, tutorial: null, extractionCalled: false, coop: { running: false } };
  game.player = { x: 500, y: 500, stunned: 0, downed: false };
  game.map = map;
  game.ui = { showToast() {}, log() {} };
  game.audio = { playTone() {} };
  game.callExtraction = actor => { game.calledBy = actor; return true; };
  game.interact();
  assert.equal(game.calledBy, game.player);
  assert.equal(map.doorUsed, undefined);
});
