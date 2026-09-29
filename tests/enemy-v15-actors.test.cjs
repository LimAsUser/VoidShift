const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = vm.createContext({ performance: { now: () => 0 } });
for (const name of ['config', 'map', 'entities']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', `${name}.js`), 'utf8'), context);
}
const { Config, MapManager, Monster, Hunter, Heavy, EntitySpatialGrid, buildPursuitWaypoints, bfsRoomPath } =
  vm.runInContext('({ Config, MapManager, Monster, Hunter, Heavy, EntitySpatialGrid, buildPursuitWaypoints, bfsRoomPath })', context);
const clearMap = { blocked: () => false, getRoomAt: () => null, worldRooms: [],
  monsterSpawns: [{ x: 900, y: 900 }] };

for (const Actor of [Hunter, Monster]) {
  test(`${Actor.name} separation finds overlapping Heavy bodies across spatial bucket boundaries`, () => {
    const actor = Actor === Hunter ? new Hunter(0, 1, () => 1) : new Monster();
    Object.assign(actor, { active: true, alerted: true, x: 100, y: 140, angle: 0, stagger: 1 });
    const heavy = new Heavy();
    heavy.activate(100, 200);
    const grid = new EntitySpatialGrid(64);
    grid.rebuild([actor, heavy]);
    actor.update(0, { x: 1000, y: 140, radius: 10 }, 100, clearMap, null, grid);
    assert.ok(actor.y < 140, 'sideways separation must see the Heavy center 60 units away in the next bucket');
    assert.equal(actor.x, 100);
  });
}

test('V15 bodies and sprites scale together; all default hunter quantities double without changing HP or intervals', () => {
  for (const [kind, radius, width] of [['hunter', 22.5, 63], ['monster', 22.5, 72], ['heavy', 44, 112]]) {
    const entity = kind === 'hunter' ? new Hunter(0, 2, () => 1) : kind === 'monster' ? new Monster() : new Heavy();
    assert.equal(entity.radius, radius, kind);
    assert.equal(Config[kind].spriteWidth, width, kind);
  }
  const expected = { easy: [[4, 2, 1], [8, 2, 1], [12, 2, 1]],
    medium: [[8, 2, 2], [12, 4, 2], [16, 6, 2]], hard: [[10, 4, 3], [16, 6, 3], [24, 8, 3]] };
  for (const [difficulty, rows] of Object.entries(expected)) {
    const profile = Config.difficultyPresets[difficulty];
    assert.equal(profile.finalTerminalSpawnCount, { easy: 6, medium: 10, hard: 16 }[difficulty]);
    assert.equal(profile.finalTerminalSpawnInterval, 30);
    ['small', 'medium', 'large'].forEach((scale, index) => {
      const value = profile.maps[scale];
      assert.deepEqual([value.hunters, value.hunterRespawnCount, value.hunterMaxHp], rows[index]);
      assert.equal(value.hunterSpawnInterval, 30);
      if (difficulty === 'medium') {
        const fallback = Config.mapScales[scale];
        assert.deepEqual([fallback.hunters, fallback.hunterRespawnCount, fallback.hunterMaxHp], rows[index]);
      }
    });
  }
});

test('enlarged Hunter and Monster contact uses target body radius and cannot damage through a wall', () => {
  for (const Actor of [Hunter, Monster]) {
    for (const blocked of [false, true]) {
      const actor = Actor === Hunter ? new Hunter(0, 1, () => 1) : new Monster();
      Object.assign(actor, { active: true, alerted: true, x: 100, y: 100 });
      const target = { x: 136, y: 100, radius: 10, flashlight: false };
      const map = { ...clearMap, rayWallDistance: (_x, _y, _dx, _dy, distance) => blocked ? 18 : distance };
      assert.equal(!!actor.update(0, target, 0, map, null, []).playerHit, !blocked, `${Actor.name} blocked=${blocked}`);
      const outside = Actor === Hunter ? new Hunter(0, 1, () => 1) : new Monster();
      Object.assign(outside, { active: true, alerted: true, x: 100, y: 100 });
      assert.equal(!!outside.update(0, { ...target, x: 138 }, 0, clearMap, null, []).playerHit, false);
    }
  }
});

test('Monster chase moves 385 per second, catches swept contact, and preserves slow wall traversal', () => {
  const monster = new Monster();
  Object.assign(monster, { active: true, alerted: true, x: 100, y: 100 });
  const far = { x: 1000, y: 100, radius: 10 };
  monster.update(0.1, far, 100, clearMap, null, []);
  assert.ok(Math.abs(monster.x - 138.5) < 0.001);
  Object.assign(monster, { x: 100, y: 100 });
  const near = { x: 180, y: 100, radius: 10 };
  assert.equal(monster.update(0.5, near, 100, clearMap, null, []).playerHit, true);
  Object.assign(monster, { x: 100, y: 100 });
  const slab = { ...clearMap, blocked: (x, _y, radius) => x + radius > 150 && x - radius < 160 };
  monster.update(0.5, far, 100, slab, null, []);
  assert.ok(monster.x < 151, `must not skip wall choke at high chase speed: ${monster.x}`);
  assert.equal(Config.monster.wallChokeSpeed, 28);
  assert.equal(Config.monster.patrolSpeedScale, 60);
  assert.equal(Config.monster.slowSpeed, 32);
});

test('reviver remains a body for seven seconds before returning', () => {
  const hunter = new Hunter(0, 1, () => 1);
  Object.assign(hunter, { active: true, trait: 'reviver' });
  hunter.registerHit(1);
  assert.equal(hunter.revivePending, true);
  assert.equal(hunter.updateDeath(6.9).revived, false);
  assert.equal(hunter.dead, true);
  assert.equal(hunter.updateDeath(0.11).revived, true);
  assert.equal(hunter.dead, false);
});

test('Heavy emits one wall impact on charge collision and none for flash stun or idle stun updates', () => {
  const heavy = new Heavy();
  heavy.activate(100, 100);
  heavy.phase = 'charge';
  const target = { x: 250, y: 100, radius: 10 };
  const map = { ...clearMap, blocked: (x, _y, radius) => x + radius >= 200 };
  const result = heavy.update(1, target, map, []);
  assert.equal(heavy.phase, 'stunned');
  assert.ok(result.wallImpact && Number.isFinite(result.wallImpact.x) && result.wallImpact.y === 100);
  assert.equal(heavy.update(0.1, target, map, []).wallImpact, undefined);
  heavy.applyFlashStun(5);
  assert.equal(heavy.update(0.1, target, map, []).wallImpact, undefined);
});

for (const [scale, count] of [['small', 16], ['medium', 26], ['large', 36]]) {
  test(`${scale}: radius 44 traverses seeded room lanes, doors, terminals, spawn points and pursuit turns`, () => {
    for (const seed of [1, 111, 12345]) {
      const map = new MapManager(scale, seed);
      assert.equal(map.functionalRooms.length, count);
      assert.equal(map.scrap.length, count * map.enemyTypes.length);
      for (const spawn of [map.spawnPoint, ...map.monsterSpawns]) {
        assert.equal(map.blocked(spawn.x, spawn.y, 44), false, `${scale}/${seed} spawn`);
      }
      map.doors.forEach(door => { door.open = true; });
      for (const room of map.worldRooms) {
        assert.equal(map.blocked(room.center.x, room.center.y, 44), false, `${scale}/${seed} center ${room.id}`);
        for (const door of room.doors) {
          const midpoint = { x: (door.p1.x + door.p2.x) / 2, y: (door.p1.y + door.p2.y) / 2 };
          assert.equal(map.isPathClear(room.center, midpoint, 44), true, `${scale}/${seed} approach ${room.id}/${door.id}`);
          if (!door.isPassage) assert.equal(Math.hypot(door.p2.x - door.p1.x, door.p2.y - door.p1.y), 128);
        }
      }
      for (const terminal of map.terminals) {
        assert.equal(map.isPathClear(terminal.room.center, terminal.approachPoint, 44), true, `${scale}/${seed} terminal`);
      }
      for (const room of map.functionalRooms) {
        let point = map.spawnPoint;
        for (const next of buildPursuitWaypoints(map, point.x, point.y, room.center.x, room.center.y, 44)) {
          assert.equal(map.isPathClear(point, next, 44), true, `${scale}/${seed} pursuit ${room.id} (${point.x},${point.y}) -> (${next.x},${next.y})`);
          point = next;
        }
      }
    }
  });
}

test('strip state is deterministic, individually seeded, and consumes no layout or loot randomness', () => {
  const map = new MapManager('medium', 111);
  const copy = new MapManager('medium', 111);
  const lights = map.worldRooms.flatMap(room => room.lights);
  assert.deepEqual(lights, copy.worldRooms.flatMap(room => room.lights));
  assert.equal(new Set(lights.map(light => light.id)).size, lights.length);
  for (const light of lights) {
    assert.ok(['normal', 'flicker', 'off'].includes(light.state));
    assert.ok(light.phase >= 0 && light.phase < 1);
  }
  assert.ok(lights.some(light => light.state === 'flicker'));
  assert.ok(lights.some(light => light.state === 'off'));
  const seedLights = MapManager.prototype._seedLights;
  try {
    MapManager.prototype._seedLights = function () {};
    const unlit = new MapManager('medium', 111);
    assert.deepEqual(map.scrap, unlit.scrap);
    assert.deepEqual(map.walls, unlit.walls);
    assert.deepEqual(map.enemyTypes, unlit.enemyTypes);
    assert.equal(map.random(), unlit.random());
    assert.notEqual(map.layoutSignature(), unlit.layoutSignature(), 'lighting state participates in compatibility signature');
  } finally {
    MapManager.prototype._seedLights = seedLights;
  }
});

for (const scale of ['small', 'medium', 'large']) {
  test(`${scale}: full Heavy movement clears corners and opens closed doors on additional seeds`, () => {
    for (const seed of [1, 111]) {
      const map = new MapManager(scale, seed);
      const start = map.getRoomAt(map.spawnPoint.x, map.spawnPoint.y);
      const candidates = map.functionalRooms.filter(room => room !== start).map(room => {
        const route = bfsRoomPath(start, room);
        const centers = [start.center, ...route.map(step => step.room.center)];
        const length = centers.slice(1).reduce((sum, point, index) =>
          sum + Math.hypot(point.x - centers[index].x, point.y - centers[index].y), 0);
        return { room, route, length };
      }).sort((a, b) => b.length - a.length);
      const destination = candidates[0];
      const heavy = new Heavy();
      heavy.activate(map.spawnPoint.x, map.spawnPoint.y);
      const target = { ...destination.room.center, radius: 10 };
      const visited = new Set();
      let hit = false;
      const ticks = Math.ceil((destination.length / 50 * 3 + 90) / 0.1);
      for (let tick = 0; tick < ticks && !hit; tick++) {
        const before = { x: heavy.x, y: heavy.y };
        map.advanceDoorAnimations(0.1, [target], [heavy]);
        hit = heavy.update(0.1, target, map, [target]).hits.includes(target);
        assert.equal(map.blocked(heavy.x, heavy.y, 44), false, `${scale}/${seed} clips at ${tick}`);
        assert.ok(Math.hypot(heavy.x - before.x, heavy.y - before.y) <= 30.001, 'no teleport recovery');
        visited.add(map.getRoomAt(heavy.x, heavy.y));
      }
      assert.equal(hit, true, `${scale}/${seed} stuck at ${heavy.x},${heavy.y}, ${heavy.phase}`);
      assert.ok([...visited].filter(room => room?.kind === 'corridor').length >= 4);
    }
  });
}
