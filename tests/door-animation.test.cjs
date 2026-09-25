const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sandbox = { window: { addEventListener() {} }, performance: { now: () => 1000 } };
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/config.js'), 'utf8')}\nglobalThis.ConfigUnderTest = Config;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/map.js'), 'utf8')}\nglobalThis.MapManagerUnderTest = MapManager;`, sandbox);
vm.runInNewContext(`${fs.readFileSync(path.join(root, 'js/game.js'), 'utf8')}\nglobalThis.GameUnderTest = Game;`, sandbox);

const MapManager = sandbox.MapManagerUnderTest;
const Game = sandbox.GameUnderTest;

function makeDoor(open = false) {
  return {
    p1: { x: 0, y: 0 }, p2: { x: 0, y: 100 },
    normal: { x: 1, y: 0 }, axis: 'v', open, openDir: 1,
    targetOpen: open, animationProgress: open ? 1 : 0
  };
}

function makeMap(door) {
  const map = Object.create(MapManager.prototype);
  map.doors = [door];
  map.walls = [];
  map.blocked = () => false;
  return map;
}

test('door collision changes only after the 0.35-second opening animation completes', () => {
  const door = makeDoor();
  const map = makeMap(door);

  map.toggleDoor(door, -20, 50);
  assert.equal(door.targetOpen, true);
  assert.equal(door.open, false);

  map.advanceDoorAnimations(0.34);
  assert.equal(door.open, false);
  assert.ok(door.animationProgress > 0 && door.animationProgress < 1);

  map.advanceDoorAnimations(0.02);
  assert.equal(door.open, true);
  assert.equal(door.animationProgress, 1);
});

test('interacting during a door animation reverses its current target', () => {
  const door = makeDoor();
  const map = makeMap(door);
  map.toggleDoor(door, -20, 50);
  map.advanceDoorAnimations(0.15);
  map.toggleDoor(door, -20, 50);

  assert.equal(door.targetOpen, false);
  assert.equal(door.open, false);
  map.advanceDoorAnimations(0.35);
  assert.equal(door.animationProgress, 0);
  assert.equal(door.open, false);
});

test('the passage stays blocked while opening and remains passable while closing', () => {
  const door = makeDoor();
  const map = makeMap(door);
  map.toggleDoor(door, -20, 50);
  map.advanceDoorAnimations(0.35);
  map.toggleDoor(door, -20, 50);
  map.advanceDoorAnimations(0.2);

  assert.equal(door.open, true);
  assert.ok(door.animationProgress > 0 && door.animationProgress < 1);
  map.advanceDoorAnimations(0.2);
  assert.equal(door.open, false);
});

test('closing safely relocates a player who re-enters the doorway before it seals', () => {
  const door = makeDoor(true);
  const player = { x: 0, y: 50, radius: 10 };
  const map = makeMap(door);
  map.advanceDoorAnimations(0, [player]);
  map.toggleDoor(door, 20, 50);
  map.advanceDoorAnimations(0.35, [player]);

  assert.equal(door.open, false);
  assert.ok(Math.hypot(player.x, player.y - 50) >= 22);
});

test('closing reverses instead of sealing when doorway clearance is impossible', () => {
  const door = makeDoor(true);
  const player = { x: 0, y: 50, radius: 10 };
  const map = makeMap(door);
  map.blocked = () => true;
  map.toggleDoor(door, 20, 50);
  const events = map.advanceDoorAnimations(0.35, [player]);

  assert.equal(door.open, true);
  assert.equal(door.targetOpen, true);
  assert.ok(events.some(event => event.blocked));
  assert.deepEqual([player.x, player.y], [0, 50]);
});

test('closing reverses when an enemy is occupying the doorway', () => {
  const door = makeDoor(true);
  const enemy = { x: 0, y: 50, radius: 12 };
  const map = makeMap(door);
  map.toggleDoor(door, 20, 50);
  const events = map.advanceDoorAnimations(0.35, [], [enemy]);

  assert.equal(door.open, true);
  assert.equal(door.targetOpen, true);
  assert.equal(door.animationProgress, 0);
  assert.ok(events.some(event => event.blocked));
});

test('co-op snapshots carry door animation state for the guest renderer', () => {
  const hostDoor = makeDoor();
  const hostMap = makeMap(hostDoor);
  hostMap.toggleDoor(hostDoor, -20, 50);
  hostMap.advanceDoorAnimations(0.14);

  const host = Object.create(Game.prototype);
  host.state = {
    elapsed: 1, extractionCalled: false, loot: 0, lootValue: 0,
    finalTerminalPressure: false, inventory: [], remoteInventory: [],
    bulletTraces: [], impactParticles: []
  };
  host.player = {};
  host.remotePlayer = {};
  host.monster = {};
  host.hunters = [];
  host.map = { ...hostMap, scrap: [], terminals: [] };
  host._playerSnapshot = () => ({});
  const snapshot = host._createCoopSnapshot();

  const guestDoor = makeDoor();
  const guest = Object.create(Game.prototype);
  guest.state = { coop: { running: true, role: 'guest' }, finalTerminalPressure: false };
  guest.player = {};
  guest.remotePlayer = {};
  guest.monster = {};
  guest.hunters = [];
  guest.map = { doors: [guestDoor], scrap: [], terminals: [] };
  guest._applyPlayerSnapshot = () => {};
  guest._lockFinalTerminalNoise = () => {};
  guest._applyCoopInventorySnapshot = () => false;
  guest.ui = { updateTerminalsStatus() {} };
  guest._applyCoopSnapshot(snapshot);

  assert.deepEqual(
    [guestDoor.open, guestDoor.targetOpen, guestDoor.animationProgress],
    [false, true, snapshot.doors[0].animationProgress]
  );
});
