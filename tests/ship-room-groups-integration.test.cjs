const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = vm.createContext({ performance: { now: () => 0 } });
for (const file of ['config', 'map', 'entities']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8'), context);
}
const { MapManager, Heavy, Config } = vm.runInContext('({ MapManager, Heavy, Config })', context);
const directDoors = map => map.doors.filter(door => door.roomA.kind === 'room' && door.roomB.kind === 'room');
const centerOf = door => ({ x: (door.p1.x + door.p2.x) / 2, y: (door.p1.y + door.p2.y) / 2 });

for (const scale of ['small', 'medium', 'large']) {
  test(`${scale}: shared-wall doors block rays when closed and retain solid walls beside the opening`, () => {
    const map = new MapManager(scale, 7);
    const doors = directDoors(map);
    assert.ok(doors.length, 'real room-to-room doors must exist');
    for (const door of doors) {
      const center = centerOf(door), { x: nx, y: ny } = door.normal;
      const origin = { x: center.x - nx * 40, y: center.y - ny * 40 };
      assert.equal(map.rayWallDistance(origin.x, origin.y, nx, ny, 80), 40, 'closed door occludes vision');
      map.toggleDoor(door, origin.x, origin.y);
      map.advanceDoorAnimations(.35, [{ ...origin, radius: 10 }]);
      assert.equal(door.open, true);
      assert.equal(map.rayWallDistance(origin.x, origin.y, nx, ny, 80), 80, 'opened door reveals next room');
      assert.equal(map.isPathClear(origin, { x: center.x + nx * 40, y: center.y + ny * 40 }, 22), true);
      const offset = Math.hypot(door.p2.x - door.p1.x, door.p2.y - door.p1.y) / 2 + 24;
      const wallOrigin = { x: origin.x - ny * offset, y: origin.y + nx * offset };
      assert.ok(map.rayWallDistance(wallOrigin.x, wallOrigin.y, nx, ny, 80) < 80,
        'opening the shared door must not erase the adjoining common wall');
    }
  });

  test(`${scale}: a shared-wall door auto-closes, reverses on approach and safely clears two occupants`, () => {
    const map = new MapManager(scale, 7);
    const door = directDoors(map)[0];
    assert.ok(door, 'a direct room connection exists');
    const center = centerOf(door);
    map.toggleDoor(door, door.roomA.center.x, door.roomA.center.y);
    map.advanceDoorAnimations(.35);
    map.advanceDoorAnimations(5);
    assert.equal(door.autoClosing, true);
    map.advanceDoorAnimations(.15);
    const player = { x: center.x + door.normal.x * 60, y: center.y + door.normal.y * 60, radius: 10, downed: true };
    map.advanceDoorAnimations(.05, [player]);
    assert.equal(door.targetOpen, true, 'even downed occupants reverse an automatic close');
    map.advanceDoorAnimations(.35, [player]);
    const occupants = [-5, 5].map(distance => ({ x: center.x + door.normal.x * distance,
      y: center.y + door.normal.y * distance, radius: 10 }));
    map.toggleDoor(door, player.x, player.y);
    map.advanceDoorAnimations(.35, occupants);
    assert.equal(door.open, false, 'manual close succeeds only after safe relocation');
    occupants.forEach(occupant => assert.equal(map.blocked(occupant.x, occupant.y, occupant.radius), false));
    assert.ok(Math.hypot(occupants[0].x - occupants[1].x, occupants[0].y - occupants[1].y) >= 20);
  });

  test(`${scale}: Heavy opens and fully traverses a closed room-to-room door without clipping or teleporting`, async t => {
    const map = new MapManager(scale, 7);
    const door = directDoors(map)[0];
    assert.ok(door, 'a direct room connection exists');
    const heavy = new Heavy(30);
    heavy.activate(door.roomA.center.x, door.roomA.center.y);
    const target = { ...door.roomB.center, radius: 10 };
    let hit = false, opened = false, crossed = false, ticks = 0;
    const dt = .1;
    const budget = Math.ceil((Math.hypot(target.x - heavy.x, target.y - heavy.y) / Config.heavy.speed * 3 + 30) / dt);
    for (; ticks < budget && !hit; ticks++) {
      const before = { x: heavy.x, y: heavy.y };
      map.advanceDoorAnimations(dt, [target], [heavy]);
      hit = heavy.update(dt, target, map, [target]).hits.includes(target);
      opened ||= door.open;
      crossed ||= map.getRoomAt(heavy.x, heavy.y) === door.roomB;
      assert.equal(map.blocked(heavy.x, heavy.y, heavy.radius), false, `body collision on tick ${ticks}`);
      assert.ok(Math.hypot(heavy.x - before.x, heavy.y - before.y) <= Config.heavy.chargeSpeed * dt + .001,
        `teleport on tick ${ticks}`);
      if (ticks % 100 === 0) await new Promise(resolve => setImmediate(resolve));
    }
    assert.ok(opened && crossed && hit, `failed continuous room traversal after ${ticks}/${budget} ticks`);
    t.diagnostic(`${scale}: ${ticks} ticks, closed common door opened and target hit in next compartment`);
  });
}
