const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = {};
vm.createContext(context);
for (const file of ['config', 'map']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8'), context);
}
const { MapManager, pointInPolygon, distToSegment } = vm.runInContext(
  '({ MapManager, pointInPolygon, distToSegment })', context);

function graphFor(rooms) {
  const graph = new Map(Array.from(rooms, room => [room, new Set()]));
  for (const room of rooms) {
    for (const portal of room.doors) {
      const next = portal.roomA === room ? portal.roomB : portal.roomA;
      if (graph.has(next)) graph.get(room).add(next);
    }
  }
  return graph;
}

test('removing any single core junction leaves alternate routes in every scale', () => {
  for (const scale of ['small', 'medium', 'large']) for (const seed of [0, 29]) {
    const core = corridorCore(new MapManager(scale, seed));
    for (const removed of core.keys()) {
      const remaining = new Map([...core].filter(([room]) => room !== removed)
        .map(([room, neighbors]) => [room, new Set([...neighbors].filter(next => next !== removed))]));
      const reached = distances(remaining, remaining.keys().next().value);
      assert.equal(reached.size, remaining.size, `${scale}/${seed}: mandatory core node ${removed.id}`);
    }
  }
});

function corridorCore(map) {
  const graph = graphFor(map.worldRooms.filter(room => room.kind === 'corridor'));
  const leaves = [...graph.keys()].filter(room => graph.get(room).size < 2);
  while (leaves.length) {
    const room = leaves.pop();
    if (!graph.has(room)) continue;
    for (const next of graph.get(room)) {
      graph.get(next).delete(room);
      if (graph.get(next).size < 2) leaves.push(next);
    }
    graph.delete(room);
  }
  return graph;
}

function distances(graph, start, excludedEdge = []) {
  const result = new Map([[start, 0]]);
  for (const [room, distance] of result) {
    for (const next of graph.get(room)) {
      if ((room === excludedEdge[0] && next === excludedEdge[1]) ||
          (room === excludedEdge[1] && next === excludedEdge[0]) || result.has(next)) continue;
      result.set(next, distance + 1);
    }
  }
  return result;
}

function coreAttachments(room, core) {
  const visited = new Set([room]);
  const attachments = new Set();
  for (const current of visited) {
    if (core.has(current)) {
      attachments.add(current);
      continue;
    }
    for (const portal of current.doors) {
      const next = portal.roomA === current ? portal.roomB : portal.roomA;
      if (next.kind === 'corridor') visited.add(next);
    }
  }
  return attachments;
}

// Ignore IDs, coordinates, labels and corridor subdivision lengths. Each retained
// junction is described by neighboring degrees and distances to all junctions.
function connectivityFingerprint(core) {
  const junctions = [...core.keys()].filter(room => core.get(room).size !== 2);
  const reduced = new Map(junctions.map(room => [room, new Set()]));
  for (const room of junctions) {
    for (let next of core.get(room)) {
      let previous = room;
      while (!reduced.has(next)) {
        const onward = [...core.get(next)].find(candidate => candidate !== previous);
        previous = next;
        next = onward;
      }
      reduced.get(room).add(next);
    }
  }
  return [...reduced.keys()].map(room => JSON.stringify({
    degree: reduced.get(room).size,
    adjacent: [...reduced.get(room)].map(next => reduced.get(next).size).sort((a, b) => a - b),
    distances: [...distances(reduced, room)].map(([next, distance]) =>
      `${distance}:${reduced.get(next).size}`).sort()
  })).sort().join('|');
}

function inOrOnPolygon(point, polygon) {
  return pointInPolygon(point.x, point.y, polygon) || polygon.some((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    return distToSegment(point.x, point.y, a.x, a.y, b.x, b.y) < 0.001;
  });
}

function interiorsOverlap(a, b) {
  // Generated compartments are convex. Separating axes permit shared boundaries
  // but reject even a small positive-area intersection.
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i];
      const q = polygon[(i + 1) % polygon.length];
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      const nx = (q.y - p.y) / length;
      const ny = (p.x - q.x) / length;
      const pa = a.map(point => point.x * nx + point.y * ny);
      const pb = b.map(point => point.x * nx + point.y * ny);
      if (Math.max(...pa) <= Math.min(...pb) + 0.001 ||
          Math.max(...pb) <= Math.min(...pa) + 0.001) return false;
    }
  }
  return true;
}

for (const [scale, roomCount, zones, minJunctions, minCycles] of [
  ['small', 16, 3, 4, 3], ['medium', 26, 4, 6, 4], ['large', 36, 5, 8, 5]
]) {
  test(`${scale}: 30 seeds have a compact, varied, bridgeless physical corridor network`, t => {
    const fingerprints = new Set();
    let leastJunctions = Infinity;
    let leastCycles = Infinity;
    for (let seed = 0; seed < 30; seed++) {
      const label = `${scale} seed ${seed}`;
      const map = new MapManager(scale, seed);
      const core = corridorCore(map);
      const vertices = core.size;
      const edges = [...core.values()].reduce((sum, neighbors) => sum + neighbors.size, 0) / 2;
      assert.ok(vertices > 0, `${label}: corridor core exists after pruning room stubs`);
      assert.equal(distances(core, core.keys().next().value).size, vertices, `${label}: one connected core`);
      const cycles = edges - vertices + 1;
      const junctions = [...core.values()].filter(neighbors => neighbors.size >= 3).length;
      assert.ok(junctions >= minJunctions, `${label}: ${junctions} junctions, need ${minJunctions}`);
      assert.ok(cycles >= minCycles, `${label}: ${cycles} independent cycles, need ${minCycles}`);
      for (const [room, neighbors] of core) {
        for (const next of neighbors) {
          if (room.id < next.id) assert.equal(distances(core, room, [room, next]).size, vertices,
            `${label}: core bridge ${room.id}-${next.id}`);
        }
      }
      leastJunctions = Math.min(leastJunctions, junctions);
      leastCycles = Math.min(leastCycles, cycles);
      fingerprints.add(connectivityFingerprint(core));
      assert.equal(map.functionalRooms.length, roomCount);
      assert.ok(map.functionalRooms.filter(room => room.doors.length >= 2).length >= Math.ceil(roomCount / 4),
        `${label}: at least one quarter of functional rooms have two entrances`);
      const spawn = map.getRoomAt(map.spawnPoint.x, map.spawnPoint.y);
      const exit = map.getRoomAt(map.exitExtractionPoint.x, map.exitExtractionPoint.y);
      const from = coreAttachments(spawn, core);
      const to = coreAttachments(exit, core);
      assert.ok(from.size && to.size, `${label}: spawn and extraction attach to the corridor core`);
      assert.ok([...from].some(a => [...to].some(b => a !== b)), `${label}: distinct route endpoints`);
      assert.equal(new Set(map.functionalRooms.map(room => room.zone)).size, zones, `${label}: zone count`);
      assert.equal(new Set(map.terminals.map(terminal => terminal.room.zone)).size, zones,
        `${label}: one terminal in each major zone`);
      for (let zone = 0; zone < zones; zone++) {
        const attachments = new Set(map.functionalRooms.filter(room => room.zone === zone)
          .flatMap(room => [...coreAttachments(room, core)]));
        assert.ok(attachments.size >= 2, `${label}: zone ${zone} connects in two directions`);
      }
      const xs = map.shipHull.map(point => point.x);
      const ys = map.shipHull.map(point => point.y);
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);
      assert.ok(Math.max(width / height, height / width) <= 2.2, `${label}: compact hull`);
      for (let i = 0; i < map.worldRooms.length; i++) {
        const room = map.worldRooms[i];
        for (const point of room.vertices) {
          assert.ok(inOrOnPolygon(point, map.shipHull), `${label}: room ${room.id} vertex inside hull`);
          assert.ok(point.x >= 0 && point.x <= map.worldW && point.y >= 0 && point.y <= map.worldH,
            `${label}: room ${room.id} vertex inside world`);
        }
        for (let j = i + 1; j < map.worldRooms.length; j++) {
          assert.equal(interiorsOverlap(room.vertices, map.worldRooms[j].vertices), false,
            `${label}: room ${room.id} overlaps ${map.worldRooms[j].id}`);
        }
      }
      const copy = new MapManager(scale, seed);
      assert.equal(copy.layoutSignature(), map.layoutSignature(), `${label}: repeatable signature`);
      assert.equal(connectivityFingerprint(corridorCore(copy)), connectivityFingerprint(core),
        `${label}: repeatable connectivity`);
    }
    assert.ok(fingerprints.size >= 3, `${scale}: only ${fingerprints.size} distinct core connectivities`);
    t.diagnostic(`${scale}: 30 seeds; minimum ${leastJunctions} junctions / ${leastCycles} cycles; ${fingerprints.size} connectivity fingerprints`);
  });
}

test('open passage records match physical wall cutouts and stay separate from closable doors', () => {
  for (const scale of ['small', 'medium', 'large']) {
    const map = new MapManager(scale, 12345);
    assert.ok(Array.isArray(map.passages) && map.passages.length > 0, `${scale}: open passages`);
    const portals = new Set([...map.doors, ...map.passages]);
    for (const room of map.worldRooms) {
      for (const portal of room.doors) {
        assert.ok(portals.has(portal), `${scale}: every navigation edge has a physical portal`);
        assert.ok(portal.roomA === room || portal.roomB === room);
      }
    }
    for (const portal of portals) {
      assert.ok(map.worldRooms.includes(portal.roomA) && map.worldRooms.includes(portal.roomB));
      assert.ok(portal.roomA.doors.includes(portal) && portal.roomB.doors.includes(portal));
      assert.ok(portal.p1 && portal.p2 && portal.normal);
      assert.ok(Math.abs(Math.hypot(portal.normal.x, portal.normal.y) - 1) < 0.001);
      for (const endpoint of [portal.p1, portal.p2]) {
        assert.ok(endpoint.x >= 0 && endpoint.x <= map.worldW && endpoint.y >= 0 && endpoint.y <= map.worldH,
          `${scale}: shifted portal ${portal.id} remains in world bounds`);
        assert.ok(inOrOnPolygon(endpoint, portal.roomA.vertices) && inOrOnPolygon(endpoint, portal.roomB.vertices),
          `${scale}: shifted portal ${portal.id} joins both actual rooms`);
      }
      if (portal.roomA.kind === 'corridor' && portal.roomB.kind === 'corridor') {
        assert.equal(portal.isPassage, true, `${scale}: ordinary corridor junction has no fake gate`);
      }
      if (portal.isPassage) {
        assert.ok(map.passages.includes(portal));
        assert.equal(map.doors.includes(portal), false);
        assert.equal(portal.open, true);
        assert.equal(portal.targetOpen, true);
        assert.equal(map.toggleDoor(portal, portal.p1.x, portal.p1.y).open, true);
        assert.equal(portal.open, true, 'manual toggle cannot close a passage');
        assert.equal(portal.targetOpen, true, 'manual toggle cannot schedule a passage close');
      } else {
        assert.ok(map.doors.includes(portal));
        assert.equal(Math.round(Math.hypot(portal.p2.x - portal.p1.x, portal.p2.y - portal.p1.y)), 128);
        portal.open = true;
      }
    }
    for (const portal of portals) {
      const center = { x: (portal.p1.x + portal.p2.x) / 2, y: (portal.p1.y + portal.p2.y) / 2 };
      for (let offset = -40; offset <= 40; offset += 8) {
        assert.equal(map.blocked(center.x + portal.normal.x * offset, center.y + portal.normal.y * offset, 22),
          false, `${scale}: body crosses ${portal.id} at ${offset}`);
      }
      for (const room of [portal.roomA, portal.roomB]) {
        assert.equal(map.isPathClear(room.center, center, 22), true,
          `${scale}: room ${room.id} clear approach to ${portal.id}`);
      }
    }
    map.advanceDoorAnimations(10);
    for (const passage of map.passages) {
      assert.equal(passage.open, true);
      assert.equal(passage.targetOpen, true);
    }
    const signature = map.layoutSignature();
    const passage = map.passages[0];
    passage.p1 = { ...passage.p1, x: passage.p1.x + 1 };
    map._layoutSignatureCache = null;
    assert.notEqual(map.layoutSignature(), signature, `${scale}: signature includes passage geometry`);
  }
});
