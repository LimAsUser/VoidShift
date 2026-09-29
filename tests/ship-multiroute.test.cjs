const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const context = vm.createContext({});
for (const file of ['config', 'map']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8'), context);
}
const { MapManager, distToSegment } = vm.runInContext('({ MapManager, distToSegment })', context);

for (const [scale, routeCount, minimum, maximum] of [
  ['small', 3, 6, 8], ['medium', 4, 9, 13], ['large', 5, 12, 18]
]) {
  test(`${scale}: 30 seeds retain substantial physical main routes and co-wall room groups`, () => {
    const groupSizes = new Set();
    for (let seed = 0; seed < 30; seed++) {
      const map = new MapManager(scale, seed);
      const label = `${scale}/${seed}`;
      const routes = map.network.majorRoutes;
      assert.ok(Array.isArray(routes), `${label}: explicit major routes`);
      assert.equal(routes.length, routeCount, label);
      const byId = new Map(map.worldRooms.map(room => [room.id, room]));
      const portals = new Map([...map.doors, ...map.passages].map(portal => [portal.id, portal]));
      for (const route of routes) {
        assert.ok(route.edgeKeys.length >= 6, `${label}: substantial route`);
        const unique = route.edgeKeys.filter(key => routes.every(other => other === route || !other.edgeKeys.includes(key)));
        assert.ok(unique.length >= 2, `${label}: independent route section`);
        assert.deepEqual(Array.from(route.uniqueEdgeKeys).sort(), Array.from(unique).sort());
        assert.equal(route.nodeKeys.length, route.edgeKeys.length + 1);
        assert.equal(route.roomIds.length, route.edgeKeys.length * 2 + 1);
        assert.equal(route.portalIds.length, route.roomIds.length - 1);
        assert.ok(new Set(route.zones).size >= 2, `${label}: route crosses zones`);
        const directions = new Set();
        for (let i = 0; i < route.portalIds.length; i++) {
          const portal = portals.get(route.portalIds[i]);
          const a = byId.get(route.roomIds[i]), b = byId.get(route.roomIds[i + 1]);
          assert.ok(portal && portal.isPassage && a.doors.includes(portal) && b.doors.includes(portal),
            `${label}: route follows real adjacent corridor portals`);
          directions.add(a.center.x === b.center.x ? 'vertical' : 'horizontal');
        }
        assert.equal(directions.size, 2, `${label}: route turns`);
      }
      const groups = map.network.roomGroups;
      assert.ok(Array.isArray(groups) && groups.length, `${label}: room groups`);
      const grouped = new Set(groups.flatMap(group => Array.from(group.roomIds)));
      assert.ok(grouped.size >= minimum && grouped.size <= maximum, `${label}: ${grouped.size} grouped rooms`);
      map.doors.forEach(door => { door.open = true; });
      for (const group of groups) {
        groupSizes.add(group.roomIds.length);
        assert.ok(group.roomIds.length >= 2 && group.roomIds.length <= 4);
        assert.ok(new Set(group.exitDirections).size >= 2, `${label}: different external exit directions`);
        assert.ok(group.externalDoorIds.length >= 2);
        assert.equal(group.doorIds.length, group.roomIds.length - 1);
        const reached = new Set([group.roomIds[0]]);
        for (const id of reached) for (const doorId of group.doorIds) {
          const door = portals.get(doorId);
          assert.ok(door && door.roomA.kind === 'room' && door.roomB.kind === 'room' && !door.isPassage);
          assert.ok(group.roomIds.includes(door.roomA.id) && group.roomIds.includes(door.roomB.id));
          if (door.roomA.id === id) reached.add(door.roomB.id);
          if (door.roomB.id === id) reached.add(door.roomA.id);
          for (const room of [door.roomA, door.roomB]) {
            assert.equal(room.roomGroupId, group.id);
            for (const p of [door.p1, door.p2]) {
              assert.ok(room.vertices.some((a, i) => {
                const b = room.vertices[(i + 1) % room.vertices.length];
                return distToSegment(p.x, p.y, a.x, a.y, b.x, b.y) < 0.001;
              }), `${label}: actual shared wall without hidden stub`);
            }
            const center = { x: (door.p1.x + door.p2.x) / 2, y: (door.p1.y + door.p2.y) / 2 };
            assert.ok(map.isPathClear(room.center, center, 22), `${label}: Heavy reaches direct door`);
          }
        }
        assert.equal(reached.size, group.roomIds.length, `${label}: connected room group`);
      }
      const copy = new MapManager(scale, seed);
      assert.equal(JSON.stringify(copy.network), JSON.stringify(map.network), `${label}: metadata deterministic`);
      assert.equal(copy.layoutSignature(), map.layoutSignature());
      assert.ok(map.network.generationAttempt <= 4);
    }
    assert.ok(groupSizes.size >= 2, `${scale}: group sizes vary across seeds`);
  });
}
