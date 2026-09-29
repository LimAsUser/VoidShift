const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = { performance: { now: () => 0 } };
vm.createContext(context);
for (const file of ['config', 'map', 'entities']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8'), context);
}
const { MapManager, Heavy, Config, bfsRoomPath, pointInPolygon } = vm.runInContext(
  '({MapManager, Heavy, Config, bfsRoomPath, pointInPolygon})', context);

for (const [scale, count, terminals] of [['small', 16, 3], ['medium', 26, 4], ['large', 36, 5]]) {
  test(`${scale}: thirty fixed seeds preserve the complete deck, loot and Heavy-clear portals`, async t => {
    const began = performance.now();
    for (let seed = 0; seed < 30; seed++) {
      let map;
      assert.doesNotThrow(() => { map = new MapManager(scale, seed); }, `${scale} seed ${seed}`);
      assert.equal(map.functionalRooms.length, count, `${scale} seed ${seed}`);
      assert.equal(map.scrap.length, count * map.enemyTypes.length);
      assert.equal(map.terminals.length, terminals);
      map.doors.forEach(door => { door.open = true; });
      for (const room of map.worldRooms) {
        assert.equal(map.scrap.filter(item => item.roomIndex === room.roomIndex).length,
          room.kind === 'room' ? map.enemyTypes.length : 0);
        assert.equal(map.blocked(room.center.x, room.center.y, 22), false);
        assert.ok(room.isStart || bfsRoomPath(map.functionalRooms[0], room).length > 0);
        if (room.kind === 'corridor') assert.equal(map.terminals.some(terminal => terminal.room === room), false);
        for (const portal of room.doors) {
          const center = { x: (portal.p1.x + portal.p2.x) / 2, y: (portal.p1.y + portal.p2.y) / 2 };
          assert.equal(map.isPathClear(room.center, center, 22), true,
            `${scale} seed ${seed} room ${room.id} approach to ${portal.id}`);
        }
      }
      for (const door of [...map.doors, ...map.passages]) {
        const x = (door.p1.x + door.p2.x) / 2;
        const y = (door.p1.y + door.p2.y) / 2;
        for (let distance = -40; distance <= 40; distance += 8) {
          assert.equal(map.blocked(x + door.normal.x * distance, y + door.normal.y * distance, 22), false,
            `${scale} seed ${seed} ${door.id} portal ${distance}`);
        }
      }
      for (const item of map.scrap) {
        const room = map.worldRooms[item.roomIndex];
        assert.equal(room.kind, 'room');
        assert.ok(pointInPolygon(item.x, item.y, room.vertices));
        assert.equal(map.blocked(item.x, item.y, 22), false);
        assert.ok(room.lootPool.some(template => template.name === item.name && template.baseValue === item.value));
      }
      for (const terminal of map.terminals) {
        assert.equal(map.isPathClear(terminal.room.center, terminal.approachPoint, 22), true);
      }
      await new Promise(resolve => setImmediate(resolve));
    }
    t.diagnostic(`${scale}: 30 generated ships and all portals checked in ${(performance.now() - began).toFixed(0)} ms`);
  });
}

for (const scale of ['small', 'medium', 'large']) {
  test(`${scale}: Heavy continuously traverses turns and junctions, opening real doors, until hitting a distant target`, async t => {
    const map = new MapManager(scale, 12345);
    const start = map.getRoomAt(map.spawnPoint.x, map.spawnPoint.y);
    const destinations = map.functionalRooms.filter(room => room !== start).map(room => {
      const route = bfsRoomPath(start, room);
      const centers = [start.center, ...route.map(step => step.room.center)];
      const length = centers.slice(1).reduce((sum, point, index) =>
        sum + Math.hypot(point.x - centers[index].x, point.y - centers[index].y), 0);
      return { room, route, centers, length };
    }).sort((a, b) => b.length - a.length);
    const destination = destinations.find(({ route, centers }) => {
      let turns = 0;
      for (let i = 1; i + 1 < centers.length; i++) {
        const a = { x: centers[i].x - centers[i - 1].x, y: centers[i].y - centers[i - 1].y };
        const b = { x: centers[i + 1].x - centers[i].x, y: centers[i + 1].y - centers[i].y };
        if ((a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)) < 0.7) turns++;
      }
      return turns >= 2 && route.filter(step => step.room.kind === 'corridor').length >= 4;
    });
    assert.ok(destination, 'a distant multi-turn route exists');
    assert.equal(map.isPathClear(start.center, destination.room.center, 22, true), false,
      'target cannot be reached by a straight charge');
    for (const door of map.doors) {
      door.open = false;
      door.targetOpen = false;
      door.animationProgress = 0;
    }
    const heavy = new Heavy(30);
    heavy.activate(start.center.x, start.center.y);
    const target = { ...destination.room.center, radius: 10 };
    const visited = new Set([start]);
    const opened = new Set();
    const closedAgain = new Set();
    const dt = 0.1;
    let hit = false;
    let ticks = 0;
    let movedTicks = 0;
    let turns = 0;
    let lastHeading = null;
    const began = performance.now();
    const tickBudget = Math.ceil((destination.length / Config.heavy.speed * 3 + 90) / dt);
    for (; ticks < tickBudget && !hit; ticks++) {
      const before = { x: heavy.x, y: heavy.y };
      map.advanceDoorAnimations(dt, [target], [heavy]);
      hit = heavy.update(dt, target, map, [target]).hits.includes(target);
      const dx = heavy.x - before.x;
      const dy = heavy.y - before.y;
      const distance = Math.hypot(dx, dy);
      assert.equal(map.blocked(heavy.x, heavy.y, heavy.radius), false, `tick ${ticks}: body clips geometry`);
      assert.ok(distance <= Config.heavy.chargeSpeed * dt + 0.001,
        `tick ${ticks}: position correction exceeds actual movement speed`);
      if (distance > 0.01) {
        movedTicks++;
        const heading = { x: dx / distance, y: dy / distance };
        if (lastHeading && heading.x * lastHeading.x + heading.y * lastHeading.y < 0.7) turns++;
        lastHeading = heading;
      }
      visited.add(map.getRoomAt(heavy.x, heavy.y));
      for (const door of map.doors) {
        if (door.open) opened.add(door);
        else if (opened.has(door)) closedAgain.add(door);
      }
      assert.ok(map.passages.every(passage => passage.open && passage.targetOpen));
      if (ticks % 100 === 0) await new Promise(resolve => setImmediate(resolve));
    }
    const waypoint = heavy.waypoints[0];
    assert.equal(hit, true, `Heavy stuck: ${JSON.stringify({
      x: heavy.x, y: heavy.y, phase: heavy.phase, ticks, tickBudget, turns,
      room: map.getRoomAt(heavy.x, heavy.y)?.id, target: destination.room.id,
      waypoint: waypoint && { x: waypoint.x, y: waypoint.y, isDoor: waypoint.isDoor,
        room: waypoint.room?.id, portal: waypoint.door?.id, isPassage: waypoint.door?.isPassage,
        open: waypoint.door?.open, targetOpen: waypoint.door?.targetOpen }
    })}`);
    assert.ok(visited.has(destination.room));
    assert.ok([...visited].filter(room => room?.kind === 'corridor').length >= 4);
    assert.ok([...visited].some(room => room?.kind === 'corridor' && room.doors.filter(portal =>
      (portal.roomA === room ? portal.roomB : portal.roomA).kind === 'corridor').length >= 3), 'visits an actual junction');
    assert.ok(turns >= 2, `continuous movement made ${turns} turns`);
    assert.ok(movedTicks > 100, 'simulates sustained movement');
    assert.ok(opened.size >= 2, 'opens the origin and destination room doors');
    assert.ok(closedAgain.size > 0, 'a passed real door automatically closes');
    t.diagnostic(`${scale}: ${ticks}/${tickBudget} ticks, ${movedTicks} moving ticks, ${turns} turns, ${opened.size} doors opened / ${closedAgain.size} auto-closed; ${(ticks * dt).toFixed(1)} simulated seconds; ${(performance.now() - began).toFixed(0)} ms wall time`);
  });
}
