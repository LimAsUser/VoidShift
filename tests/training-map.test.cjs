const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function load(mapFile = 'js/map.js') {
  const context = vm.createContext({});
  for (const file of ['js/config.js', 'js/inventory.js', mapFile, 'js/entities.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  return vm.runInContext('({ MapManager, Config, Heavy, buildPursuitWaypoints, bfsRoomPath })', context);
}

test('training factory is deterministic and leaves the live world configuration untouched', () => {
  const { MapManager, Config } = load();
  const configBefore = JSON.stringify(Config);
  assert.equal(typeof MapManager.createTraining, 'function');
  const first = MapManager.createTraining();
  const second = MapManager.createTraining();
  assert.equal(JSON.stringify(Config), configBefore);
  assert.equal(first.isTraining, true);
  assert.equal(first.worldW, 2000);
  assert.equal(first.worldH, 1280);
  assert.equal(first.functionalRooms.length, 6);
  assert.equal(first.terminals.length, 2);
  assert.equal(first.layoutSignature(), second.layoutSignature());
  for (const point of Object.values(first.trainingPoints)) {
    assert.equal(first.blocked(point.x, point.y, Config.heavy.radius), false, 'lesson point is clear with doors closed');
  }
  assert.equal(first.getRoomAt(first.trainingPoints.firing.x, first.trainingPoints.firing.y).trainingArea, 'hunter');
  first.trainingDoor.open = true;
  assert.equal(second.trainingDoor.open, false);
});

test('preview factory does not change existing normal maps or subsequent seeded generation', () => {
  const { MapManager, Config } = load();
  for (const seed of [1, 12345]) {
    const before = new MapManager('small', seed);
    const expected = before.layoutSignature();
    const globals = JSON.stringify(Config);
    const walls = JSON.stringify(before.walls);
    const loot = JSON.stringify(before.scrap);
    MapManager.createTraining();
    assert.equal(JSON.stringify(Config), globals);
    assert.equal(before.layoutSignature(), expected);
    assert.equal(JSON.stringify(before.walls), walls);
    assert.equal(JSON.stringify(before.scrap), loot);
    const after = new MapManager('small', seed);
    assert.equal(after.layoutSignature(), expected);
    assert.equal(JSON.stringify(after.walls), walls);
    assert.equal(JSON.stringify(after.scrap), loot);
  }
});

test('all teaching points, terminals and ring doorways admit the actual Heavy body', () => {
  const { MapManager, Config, buildPursuitWaypoints, bfsRoomPath } = load();
  const map = MapManager.createTraining();
  const radius = Config.heavy.radius;
  assert.equal(radius, 44);
  map.doors.forEach(door => { door.open = true; });
  assert.equal(map.doors.length, 12);
  assert.equal(map.worldRooms.length, 12);
  assert.equal(map.network.cycles, 1);
  const destinations = [...Object.values(map.trainingPoints), ...map.terminals.map(t => t.approachPoint)];
  for (const destination of destinations) {
    assert.equal(map.blocked(destination.x, destination.y, radius), false);
    let previous = map.spawnPoint;
    const waypoints = buildPursuitWaypoints(map, previous.x, previous.y, destination.x, destination.y, radius);
    assert.ok(waypoints.length);
    for (const next of waypoints) {
      assert.equal(map.isPathClear(previous, next, radius), true, `${previous.x},${previous.y} → ${next.x},${next.y}`);
      previous = next;
    }
    assert.ok(Math.hypot(previous.x - destination.x, previous.y - destination.y) < 1);
  }
  for (const room of map.worldRooms) {
    assert.equal(room.doors.length, 2);
    assert.ok(room === map.functionalRooms[0] || bfsRoomPath(map.functionalRooms[0], room).length);
    for (const door of room.doors) {
      const center = { x: (door.p1.x + door.p2.x) / 2, y: (door.p1.y + door.p2.y) / 2 };
      assert.equal(Math.hypot(door.p2.x - door.p1.x, door.p2.y - door.p1.y), 128);
      assert.equal(map.isPathClear(room.center, center, radius), true);
    }
    assert.ok(room.lights.every(light => light.state === 'normal'));
  }
  assert.ok(map.functionalRooms[4].w >= 600 && map.functionalRooms[4].h >= 480);
  const items = map.containers.flatMap(box => box.items);
  assert.equal(items.every(item => item.value === 0), true);
  assert.deepEqual(Array.from(items, item => item.id), ['training-part', 'training-oxygen', 'training-medkit']);
  for (const terminal of map.terminals) {
    assert.equal(terminal.sequence.length, 5);
    assert.equal(terminal.roomIndex, terminal.room.roomIndex);
    assert.ok(Math.hypot(terminal.x - terminal.approachPoint.x, terminal.y - terminal.approachPoint.y) <= 70);
  }
});

test('Heavy follows real training doors, turns through the ring and wall-stuns in its arena', () => {
  const { MapManager, Heavy } = load();
  const map = MapManager.createTraining();
  const heavy = new Heavy();
  heavy.activate(220, 320);
  heavy.alerted = true; // Traversal exercise begins after acquisition, not a stealth test.
  const target = { x: 1000, y: 320, radius: 10 };
  for (let tick = 0; tick < 400; tick++) {
    heavy.update(0.05, target, map, [target]);
    map.advanceDoorAnimations(0.05, [target], [heavy]);
  }
  assert.ok(heavy.x > 700, `Heavy failed to open and cross the training doors: ${heavy.x}`);
  map.doors.forEach(door => { door.open = true; door.targetOpen = true; });
  heavy.activate(1700, 320);
  const aroundCorner = { x: 1550, y: 960, radius: 10 };
  for (let tick = 0; tick < 500 && heavy.y < 800; tick++) heavy.update(0.05, aroundCorner, map, [aroundCorner]);
  assert.ok(heavy.y > 800, `Heavy failed the corridor turn: ${heavy.x}, ${heavy.y}`);
  heavy.activate(map.trainingPoints.heavySpawn.x, map.trainingPoints.heavySpawn.y);
  const bait = { ...map.trainingPoints.heavyEntry, radius: 10 };
  heavy.update(0.05, bait, map, [bait]);
  assert.equal(heavy.phase, 'windup');
  heavy.update(2, bait, map, [bait]);
  assert.equal(heavy.phase, 'charge');
  bait.y = 960;
  let impact;
  for (let tick = 0; tick < 100 && heavy.phase === 'charge'; tick++) {
    impact = heavy.update(0.05, bait, map, [bait]).wallImpact || impact;
  }
  assert.equal(heavy.phase, 'stunned');
  assert.ok(impact);
});
