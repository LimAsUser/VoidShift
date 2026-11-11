const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = { window: { addEventListener() {} } };
vm.createContext(context);
for (const file of ['config', 'inventory', 'map', 'entities']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8'), context);
}
const { Hunter, MapManager, Config } = vm.runInContext('({ Hunter, MapManager, Config })', context);
const visible = (...args) => vm.runInContext('typeof isPointVisibleToPlayer', context) === 'function' &&
  vm.runInContext('isPointVisibleToPlayer', context)(...args);

function makeMap() {
  const map = Object.create(MapManager.prototype);
  const room = { x: 100, y: 100, w: 400, h: 400, center: { x: 300, y: 300 }, lights: [{}], doors: [] };
  const corridor = { x: 500, y: 200, w: 600, h: 200, center: { x: 800, y: 300 }, lights: [{}], doors: [] };
  const door = { p1: { x: 500, y: 260 }, p2: { x: 500, y: 340 }, normal: { x: 1, y: 0 }, roomA: room, roomB: corridor, open: true };
  room.doors.push(door);
  corridor.doors.push(door);
  map.worldRooms = [room, corridor];
  map.doors = [door];
  map.walls = [
    { x1: 100, y1: 100, x2: 500, y2: 100 },
    { x1: 100, y1: 100, x2: 100, y2: 500 },
    { x1: 100, y1: 500, x2: 500, y2: 500 },
    { x1: 500, y1: 100, x2: 500, y2: 260 },
    { x1: 500, y1: 340, x2: 500, y2: 500 }
  ];
  map.monsterSpawns = [{ x: 300, y: 300 }];
  return map;
}

function activate(map = makeMap()) {
  const hunter = new Hunter(0, 3, () => 0.27);
  hunter.reset(map, 3);
  hunter.activate(950, 300, 'test', null, map, Math.PI);
  return hunter;
}

const awayPlayer = { x: 800, y: 300, angle: 0, flashlight: true, downed: false };

test('visibility uses near ambient and the forward cone, including the shorter torch-off range', () => {
  const map = makeMap();
  const player = { x: 300, y: 300, angle: 0, flashlight: false };
  assert.equal(visible(240, 300, player, map), true);
  assert.equal(visible(220, 300, player, map), false);
  assert.equal(visible(420, 300, player, map), true);
  assert.equal(visible(440, 300, player, map), false);
  assert.equal(visible(440, 300, { ...player, flashlight: true }, map), true);
  assert.equal(visible(360, 300, { ...player, downed: true }, map), false);
  assert.equal(visible(360, 300, { ...player, dead: true }, map), false);
});

test('closed doors and walls occlude actual sight even when the target room has lights', () => {
  const map = makeMap();
  const player = { x: 300, y: 300, angle: 0, flashlight: true };
  assert.equal(visible(550, 300, player, map, true), true);
  map.doors[0].open = false;
  assert.equal(visible(550, 300, player, map, true), false);
  assert.equal(visible(550, 280, player, map, true), false);
  map.doors[0].open = true;
  assert.equal(visible(520, 240, { ...player, y: 240 }, map, true), false);
});

test('powered target-room lights extend forward sight while an unlit target and radar do not', () => {
  const map = makeMap();
  const player = { x: 300, y: 300, angle: 0, flashlight: false, lifeScanActive: true, lifeScanPassive: true };
  assert.equal(visible(850, 300, player, map, false), false);
  assert.equal(visible(850, 300, player, map, true), true);
  map.worldRooms[1].lights = [];
  assert.equal(visible(850, 300, player, map, true), false);
});

test('ambusher walks from its spawn to a safe door-jamb cell and waits without teleporting', () => {
  const map = makeMap();
  const hunter = activate(map);
  assert.equal(hunter.trait, 'ambusher');
  assert.equal(hunter.x, 300);
  assert.equal(hunter.y, 300);
  assert.ok(hunter.ambushTarget);
  assert.equal(map.getRoomAt(hunter.ambushTarget.x, hunter.ambushTarget.y), map.worldRooms[0]);
  assert.equal(map.blocked(hunter.ambushTarget.x, hunter.ambushTarget.y, hunter.radius), false);
  assert.ok(hunter.ambushTarget.y < 260 || hunter.ambushTarget.y > 340);
  for (let index = 0; index < 55; index++) {
    const before = { x: hunter.x, y: hunter.y };
    hunter.update(0.1, awayPlayer, 100, map, null, [], [awayPlayer]);
    assert.ok(Math.hypot(hunter.x - before.x, hunter.y - before.y) <= 8.001);
    assert.equal(map.blocked(hunter.x, hunter.y, hunter.radius), false);
    assert.equal(hunter.ambushTriggered, false);
  }
  assert.ok(Math.hypot(hunter.x - hunter.ambushTarget.x, hunter.y - hunter.ambushTarget.y) < 5);
  const camp = { x: hunter.x, y: hunter.y };
  hunter.update(1, awayPlayer, 100, map, null, [], [awayPlayer]);
  assert.deepEqual({ x: hunter.x, y: hunter.y }, camp);
});

test('a seeing teammate wakes the ambush and becomes the immediate nearest pursuit target', () => {
  const map = makeMap();
  const hunter = activate(map);
  const near = { x: 200, y: 300, angle: 0, flashlight: true };
  const farther = { x: 300, y: 150, angle: Math.PI / 2, flashlight: true };
  hunter.update(0.1, awayPlayer, 0, map, null, [], [farther, near]);
  assert.equal(hunter.ambushTriggered, true);
  assert.equal(hunter.alerted, true);
  assert.ok(hunter.x < 300);
  assert.ok(Math.abs(hunter.y - 300) < 0.001);
  hunter.alerted = false;
  hunter.update(0.1, awayPlayer, 0, map, null, [], [awayPlayer]);
  assert.equal(hunter.ambushTriggered, true);
  assert.equal(hunter.ambushTarget, null);
});

test('an ambusher follows a same-room detour when a wall blocks direct travel to the jamb', () => {
  const map = makeMap();
  map.walls.push({ x: 360, y: 210, w: 45, h: 180 });
  const hunter = activate(map);
  assert.ok(hunter.ambushTarget);
  assert.ok(hunter.localPath.length > 0);
  for (let index = 0; index < 120; index++) {
    const before = { x: hunter.x, y: hunter.y };
    hunter.update(0.1, awayPlayer, 0, map, null, [], [awayPlayer]);
    assert.ok(Math.hypot(hunter.x - before.x, hunter.y - before.y) <= 8.001);
    assert.equal(map.blocked(hunter.x, hunter.y, hunter.radius), false);
    assert.equal(map.getRoomAt(hunter.x, hunter.y), map.worldRooms[0]);
  }
  assert.ok(Math.hypot(hunter.x - hunter.ambushTarget.x, hunter.y - hunter.ambushTarget.y) < 5);
});

test('generated ship spawn rooms supply reachable camps beside real door segments', () => {
  const map = new MapManager('small', 12345);
  const spawns = [...map.monsterSpawns];
  let camps = 0;
  for (const spawn of spawns) {
    map.monsterSpawns = [spawn];
    const hunter = activate(map);
    if (!hunter.ambushTarget) continue;
    camps++;
    assert.equal(hunter.x, spawn.x);
    assert.equal(hunter.y, spawn.y);
    assert.equal(map.getRoomAt(hunter.ambushTarget.x, hunter.ambushTarget.y), map.getRoomAt(spawn.x, spawn.y));
    assert.equal(map.blocked(hunter.ambushTarget.x, hunter.ambushTarget.y, hunter.radius), false);
  }
  assert.ok(camps >= spawns.length * 0.8, `${camps}/${spawns.length} spawn rooms have camps`);
});

test('noise, radar and downed observers do not wake a hidden ambusher', () => {
  const map = makeMap();
  const hunter = activate(map);
  const radar = { ...awayPlayer, lifeScanActive: true, lifeScanPassive: true };
  const downed = { x: 200, y: 300, angle: 0, flashlight: true, downed: true };
  hunter.update(0.1, radar, 100, map, null, [], [radar, downed]);
  assert.equal(hunter.ambushTriggered, false);
  assert.equal(hunter.alerted, false);
});

test('damage wakes immediately but a flash-stunned ambusher remains stationary', () => {
  const map = makeMap();
  const hunter = activate(map);
  hunter.applyFlashStun(2);
  assert.equal(hunter.ambushTriggered, true);
  assert.equal(hunter.registerHit().hit, true);
  assert.equal(hunter.ambushTriggered, true);
  assert.equal(hunter.alerted, true);
  hunter.update(0.5, awayPlayer, 0, map, null, [], [awayPlayer]);
  assert.equal(hunter.x, 300);
  assert.equal(hunter.y, 300);
  assert.equal(hunter.flashStunTimer, 1.5);
});

test('a hidden Hunter wakes on damage even without a flashbang', () => {
  const hunter = activate();
  hunter.registerHit();
  assert.equal(hunter.ambushTriggered, true);
  assert.equal(hunter.alerted, true);
  assert.equal(hunter.ambushTarget, null);
});

test('respawn resets the ambush for a new life without rearming during an existing life', () => {
  const map = makeMap();
  const hunter = activate(map);
  hunter.registerHit();
  hunter.active = false;
  hunter.activate(950, 300, 'test', null, map, Math.PI);
  assert.equal(hunter.ambushTriggered, true);
  assert.equal(hunter.ambushTarget, null);
  hunter.reset(map, 3);
  assert.equal(hunter.ambushTriggered, false);
  hunter.activate(950, 300, 'test', null, map, Math.PI);
  assert.ok(hunter.ambushTarget);
});

test('rooms without a safe camp use ordinary Hunter pursuit', () => {
  const map = makeMap();
  map.walls.push({ x: 410, y: 100, w: 70, h: 400 });
  const hunter = activate(map);
  assert.equal(hunter.ambushTarget, null);
  const target = { x: 200, y: 300, angle: Math.PI, flashlight: false };
  hunter.update(0.1, target, 0, map, null, [], [target]);
  assert.equal(hunter.alerted, true);
  assert.ok(hunter.x < 300);
});

test('four traits split the unchanged thirty-percent roll into equal intervals', () => {
  for (const [roll, expected] of [[0, 'photophobic'], [0.074999, 'photophobic'], [0.075, 'slim'],
    [0.149999, 'slim'], [0.15, 'reviver'], [0.224999, 'reviver'], [0.225, 'ambusher'],
    [0.299999, 'ambusher'], [0.3, null], [0.999, null]]) {
    assert.equal(Hunter.rollTrait(() => roll), expected, `roll ${roll}`);
  }
});
