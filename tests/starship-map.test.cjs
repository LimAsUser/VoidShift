const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = { window: { addEventListener() {} }, performance: { now: () => 0 } };
vm.createContext(context);
for (const file of ['config', 'map', 'entities']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8'), context);
}
const { MapManager, Config, bfsRoomPath, pointInPolygon, buildPursuitWaypoints } = vm.runInContext(
  '({ MapManager, Config, bfsRoomPath, pointInPolygon, buildPursuitWaypoints })', context);

test('seeded ships contain the requested functional rooms with connected corridors and isolated loot', () => {
  for (const [scale, count, terminalCount] of [['small', 16, 3], ['medium', 26, 4], ['large', 36, 5]]) {
    for (const seed of [1, 2, 3, 12345]) {
      const map = new MapManager(scale, seed);
      assert.ok(Array.isArray(map.functionalRooms), 'functional room contract');
      assert.equal(map.functionalRooms.length, count, `${scale}: actual room count`);
      assert.equal(map.scrap.length, count * map.enemyTypes.length);
      assert.equal(map.terminals.length, terminalCount);
      assert.ok(map.worldRooms.length > count);
      assert.ok(map.shipHull.length >= 6);
      assert.ok(map.functionalRooms.some(room => room.type === 'bridge'));
      assert.ok(map.functionalRooms.some(room => room.type === 'reactor'));
      const start = map.getRoomAt(map.spawnPoint.x, map.spawnPoint.y);
      const exit = map.getRoomAt(map.exitExtractionPoint.x, map.exitExtractionPoint.y);
      assert.equal(start.type, 'airlock');
      assert.equal(exit.type, 'evacpod');
      assert.ok(bfsRoomPath(start, exit).length > 3);
      map.worldRooms.forEach((room, index) => {
        assert.equal(room.roomIndex, index);
        assert.equal(room.id, index + 1);
        assert.ok(room === start || bfsRoomPath(start, room).length > 0);
        assert.ok(pointInPolygon(room.center.x, room.center.y, map.shipHull));
        assert.equal(map.getRoomAt(room.center.x, room.center.y), room);
        const items = map.scrap.filter(item => map.getRoomAt(item.x, item.y) === room);
        assert.equal(items.length, room.kind === 'room' ? map.enemyTypes.length : 0);
        if (room.kind === 'corridor') assert.equal(map.terminals.some(terminal => terminal.room === room), false);
        assert.ok(room.lights.length > 0);
        for (const light of room.lights) {
          assert.ok(pointInPolygon((light.x1 + light.x2) / 2, (light.y1 + light.y2) / 2, room.vertices));
          assert.ok(light.range >= Math.hypot(room.w, room.h));
        }
      });
      for (const item of map.scrap) {
        assert.equal(map.blocked(item.x, item.y, 22), false, 'loot has body clearance');
        const room = map.getRoomAt(item.x, item.y);
        assert.ok(room.lootPool.some(template => template.name === item.name && template.baseValue === item.value));
      }
      const copy = new MapManager(scale, seed);
      assert.equal(map.layoutSignature(), copy.layoutSignature());
      assert.deepEqual(Array.from(map.enemyTypes), Array.from(copy.enemyTypes));
    }
  }
});

test('Heavy can traverse every ship doorway and room lane and reach each terminal', () => {
  for (const scale of ['small', 'medium', 'large']) {
    const map = new MapManager(scale, 12345);
    map.doors.forEach(door => { door.open = true; });
    for (const room of map.worldRooms) {
      assert.equal(map.blocked(room.center.x, room.center.y, 22), false);
      for (const door of room.doors) {
        const center = { x: (door.p1.x + door.p2.x) / 2, y: (door.p1.y + door.p2.y) / 2 };
        assert.equal(map.isPathClear(room.center, center, 22), true, `${scale} room ${room.id} to ${door.id}`);
        if (!door.isPassage) assert.equal(Math.round(Math.hypot(door.p2.x - door.p1.x, door.p2.y - door.p1.y)), 128);
      }
    }
    for (const terminal of map.terminals) {
      assert.ok(terminal.approachPoint);
      assert.equal(map.isPathClear(terminal.room.center, terminal.approachPoint, 22), true);
      assert.ok(Math.hypot(terminal.x - terminal.approachPoint.x, terminal.y - terminal.approachPoint.y) < Config.TERMINAL_INTERACT_RANGE ||
        Math.hypot(terminal.x - terminal.approachPoint.x, terminal.y - terminal.approachPoint.y) <= 70);
    }
    for (const destination of map.functionalRooms) {
      let point = map.spawnPoint;
      const waypoints = buildPursuitWaypoints(map, point.x, point.y, destination.center.x, destination.center.y, 22);
      for (const next of waypoints) {
        assert.equal(map.isPathClear(point, next, 22), true, `${scale} existing pursuit to room ${destination.id}`);
        point = next;
      }
    }
  }
});

function doorFixture() {
  const map = Object.create(MapManager.prototype);
  const door = { p1: { x: 300, y: 200 }, p2: { x: 300, y: 328 }, normal: { x: 1, y: 0 },
    axis: 'v', open: true, targetOpen: true, animationProgress: 1, autoCloseTimer: 0, autoClosing: false };
  Object.assign(map, { doors: [door], walls: [], worldW: 1000, worldH: 1000 });
  return { map, door };
}

test('automatic closing needs five continuous clear seconds and accounts for downed bodies and enemy radii', () => {
  const { map, door } = doorFixture();
  map.advanceDoorAnimations(4.9);
  assert.equal(door.targetOpen, true);
  map.advanceDoorAnimations(1, [{ x: 385, y: 264, radius: 10, downed: true }]);
  assert.equal(door.autoCloseTimer, 0);
  map.advanceDoorAnimations(4.9);
  assert.equal(door.targetOpen, true);
  map.advanceDoorAnimations(1, [], [{ x: 400, y: 264, radius: 22, alive: true }]);
  assert.equal(door.autoCloseTimer, 0);
  map.advanceDoorAnimations(5, [], [{ x: 300, y: 264, radius: 22, alive: false }]);
  assert.equal(door.targetOpen, false);
  assert.equal(door.autoClosing, true);
  assert.equal(door.animationProgress, 1, 'idle time must not skip closing animation');
  map.advanceDoorAnimations(0.35);
  assert.equal(door.open, false);
});

test('approaching during automatic close reverses without moving an actor; manual closing keeps safety behavior', () => {
  const { map, door } = doorFixture();
  map.advanceDoorAnimations(5);
  map.advanceDoorAnimations(0.15);
  const progress = door.animationProgress;
  const player = { x: 389, y: 264, radius: 10 };
  map.advanceDoorAnimations(0.05, [player]);
  assert.equal(door.targetOpen, true);
  assert.equal(door.autoClosing, false);
  assert.ok(door.animationProgress > progress);
  assert.equal(player.x, 389);
  map.advanceDoorAnimations(0.35, [player]);
  map.toggleDoor(door, player.x, player.y);
  map.advanceDoorAnimations(0.35, [player]);
  assert.equal(door.open, false, 'nearby actor outside doorway must not reverse manual close');
});

test('guest interpolation never makes automatic door decisions or advances its timer', () => {
  const { map, door } = doorFixture();
  map.advanceDoorAnimations(10, [], [], false);
  assert.equal(door.targetOpen, true);
  assert.equal(door.autoCloseTimer, 0);
  door.targetOpen = false;
  door.autoClosing = true;
  map.advanceDoorAnimations(0.15, [{ x: 300, y: 264, radius: 10 }], [], false);
  assert.equal(door.targetOpen, false);
  assert.equal(door.autoClosing, true);
  assert.ok(door.animationProgress < 1);
  assert.equal(door.open, true);
});
