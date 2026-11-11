/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * Seeded starship deck with functional compartments, corridor branches and loops.
 * Polygon rooms share the same doors, wall segments and navigation graph.
 */

const Vec2 = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  dot: (a, b) => a.x * b.x + a.y * b.y,
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  normalize: (a) => {
    const l = Math.hypot(a.x, a.y) || 1;
    return { x: a.x / l, y: a.y / l };
  },
  rotate: (a, angle) => ({
    x: a.x * Math.cos(angle) - a.y * Math.sin(angle),
    y: a.x * Math.sin(angle) + a.y * Math.cos(angle)
  })
};

function polygonSAT(polyA, polyB) {
  const polys = [polyA, polyB];
  for (let i = 0; i < polys.length; i++) {
    const p = polys[i];
    for (let j = 0; j < p.length; j++) {
      const p1 = p[j];
      const p2 = p[(j + 1) % p.length];
      const edge = Vec2.sub(p2, p1);
      const axis = Vec2.normalize({ x: -edge.y, y: edge.x });

      let minA = Infinity, maxA = -Infinity;
      for (const v of polyA) {
        const proj = Vec2.dot(v, axis);
        if (proj < minA) minA = proj;
        if (proj > maxA) maxA = proj;
      }

      let minB = Infinity, maxB = -Infinity;
      for (const v of polyB) {
        const proj = Vec2.dot(v, axis);
        if (proj < minB) minB = proj;
        if (proj > maxB) maxB = proj;
      }

      if (maxA <= minB + 6 || maxB <= minA + 6) {
        return false;
      }
    }
  }
  return true;
}

function pointInPolygon(px, py, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function raySegmentIntersect(ox, oy, dx, dy, x1, y1, x2, y2) {
  const sx = x2 - x1, sy = y2 - y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-6) return Infinity;
  const t = ((x1 - ox) * sy - (y1 - oy) * sx) / denom;
  const u = ((x1 - ox) * dy - (y1 - oy) * dx) / denom;
  if (t >= 0 && u >= 0 && u <= 1) {
    return t;
  }
  return Infinity;
}

function bfsRoomPath(fromRoom, toRoom) {
  if (!fromRoom || !toRoom || fromRoom === toRoom) return [];
  const visited = new Set([fromRoom]);
  const queue = [[fromRoom, []]];
  while (queue.length) {
    const [room, path] = queue.shift();
    for (const door of room.doors) {
      const next = door.roomA === room ? door.roomB : door.roomA;
      if (!visited.has(next)) {
        visited.add(next);
        const newPath = [...path, { door, room: next }];
        if (next === toRoom) return newPath;
        queue.push([next, newPath]);
      }
    }
  }
  return [];
}

function getRoomGraphDistances(fromRoom) {
  const distances = new Map([[fromRoom, 0]]);
  const queue = [fromRoom];
  for (let head = 0; head < queue.length; head++) {
    const room = queue[head];
    for (const door of room.doors) {
      const next = door.roomA === room ? door.roomB : door.roomA;
      if (distances.has(next)) continue;
      distances.set(next, distances.get(room) + 1);
      queue.push(next);
    }
  }
  return distances;
}

function findSafeLoopDoorCandidates(rooms) {
  const linkedPairs = new Set();
  rooms.forEach(room => room.doors.forEach(door => {
    const ids = [door.roomA.id, door.roomB.id].sort((a, b) => a - b);
    linkedPairs.add(`${ids[0]}:${ids[1]}`);
  }));

  const roomArea = vertices => vertices.reduce((sum, point, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
  const allEdges = rooms.flatMap(room => room.vertices.map((a, index) => ({
    room,
    index,
    a,
    b: room.vertices[(index + 1) % room.vertices.length]
  })));
  const candidates = [];

  for (let roomAIndex = 0; roomAIndex < rooms.length; roomAIndex++) {
    const roomA = rooms[roomAIndex];
    const verticesA = roomA.vertices;
    const outwardA = roomArea(verticesA) > 0 ? 1 : -1;
    const edgesA = verticesA.map((a, index) => {
      const b = verticesA[(index + 1) % verticesA.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const tx = (b.x - a.x) / length;
      const ty = (b.y - a.y) / length;
      return { a, b, tx, ty, nx: ty * outwardA, ny: -tx * outwardA };
    });

    for (let roomBIndex = roomAIndex + 1; roomBIndex < rooms.length; roomBIndex++) {
      const roomB = rooms[roomBIndex];
      const pairIds = [roomA.id, roomB.id].sort((a, b) => a - b);
      if (linkedPairs.has(`${pairIds[0]}:${pairIds[1]}`)) continue;
      const verticesB = roomB.vertices;
      const outwardB = roomArea(verticesB) > 0 ? 1 : -1;

      for (let edgeAIndex = 0; edgeAIndex < edgesA.length; edgeAIndex++) {
        const edgeA = edgesA[edgeAIndex];
        const normalProjectionA = (edgeA.a.x + edgeA.b.x) / 2 * edgeA.nx +
          (edgeA.a.y + edgeA.b.y) / 2 * edgeA.ny;
        const tangentProjectionA = point => point.x * edgeA.tx + point.y * edgeA.ty;
        const edgeAMin = Math.min(tangentProjectionA(edgeA.a), tangentProjectionA(edgeA.b));
        const edgeAMax = Math.max(tangentProjectionA(edgeA.a), tangentProjectionA(edgeA.b));

        for (let edgeBIndex = 0; edgeBIndex < verticesB.length; edgeBIndex++) {
          const edgeA2 = verticesB[edgeBIndex];
          const edgeB2 = verticesB[(edgeBIndex + 1) % verticesB.length];
          const lengthB = Math.hypot(edgeB2.x - edgeA2.x, edgeB2.y - edgeA2.y) || 1;
          const txB = (edgeB2.x - edgeA2.x) / lengthB;
          const tyB = (edgeB2.y - edgeA2.y) / lengthB;
          const nxB = tyB * outwardB;
          const nyB = -txB * outwardB;
          if (Math.abs(edgeA.tx * txB + edgeA.ty * tyB) < 0.98 ||
              edgeA.nx * nxB + edgeA.ny * nyB > -0.95) continue;

          const normalProjectionB = (edgeA2.x + edgeB2.x) / 2 * edgeA.nx +
            (edgeA2.y + edgeB2.y) / 2 * edgeA.ny;
          const gap = normalProjectionB - normalProjectionA;
          if (gap < 0 || gap > 24) continue;

          const edgeBMin = Math.min(tangentProjectionA(edgeA2), tangentProjectionA(edgeB2));
          const edgeBMax = Math.max(tangentProjectionA(edgeA2), tangentProjectionA(edgeB2));
          const overlapMin = Math.max(edgeAMin, edgeBMin);
          const overlapMax = Math.min(edgeAMax, edgeBMax);
          if (overlapMax - overlapMin < 112) continue;

          const centerAlong = (overlapMin + overlapMax) / 2;
          const centerNormal = (normalProjectionA + normalProjectionB) / 2;
          const center = {
            x: edgeA.tx * centerAlong + edgeA.nx * centerNormal,
            y: edgeA.ty * centerAlong + edgeA.ny * centerNormal
          };
          if (distToSegment(center.x, center.y, edgeA.a.x, edgeA.a.y, edgeA.b.x, edgeA.b.y) >= 12 ||
              distToSegment(center.x, center.y, edgeA2.x, edgeA2.y, edgeB2.x, edgeB2.y) >= 12) continue;
          const doorTangent = { x: -edgeA.ny, y: edgeA.nx };
          const clearance = (Config.hunter && Config.hunter.radius || 15) + 8;
          let blockedByNearbyWall = false;
          for (const wallEdge of allEdges) {
            if ((wallEdge.room === roomA && wallEdge.index === edgeAIndex) ||
                (wallEdge.room === roomB && wallEdge.index === edgeBIndex)) continue;
            const edgeMinX = Math.min(wallEdge.a.x, wallEdge.b.x);
            const edgeMaxX = Math.max(wallEdge.a.x, wallEdge.b.x);
            const edgeMinY = Math.min(wallEdge.a.y, wallEdge.b.y);
            const edgeMaxY = Math.max(wallEdge.a.y, wallEdge.b.y);
            if (edgeMaxX < center.x - 72 || edgeMinX > center.x + 72 ||
                edgeMaxY < center.y - 72 || edgeMinY > center.y + 72) continue;
            for (const normalOffset of [-18, -9, 0, 9, 18]) {
              for (const tangentOffset of [-48, -24, 0, 24, 48]) {
                const sampleX = center.x + edgeA.nx * normalOffset + doorTangent.x * tangentOffset;
                const sampleY = center.y + edgeA.ny * normalOffset + doorTangent.y * tangentOffset;
                if (distToSegment(sampleX, sampleY, wallEdge.a.x, wallEdge.a.y, wallEdge.b.x, wallEdge.b.y) < clearance) {
                  blockedByNearbyWall = true;
                  break;
                }
              }
              if (blockedByNearbyWall) break;
            }
            if (blockedByNearbyWall) break;
          }
          if (blockedByNearbyWall) continue;
          const nearExistingDoor = roomA.doors.concat(roomB.doors).some(door => {
            const x = (door.p1.x + door.p2.x) / 2;
            const y = (door.p1.y + door.p2.y) / 2;
            return Math.hypot(center.x - x, center.y - y) < 144;
          });
          if (nearExistingDoor) continue;

          const tangent = { x: -edgeA.ny, y: edgeA.nx };
          const halfWidth = 56;
          candidates.push({
            roomA,
            roomB,
            gap,
            overlap: overlapMax - overlapMin,
            center,
            normal: { x: edgeA.nx, y: edgeA.ny },
            p1: { x: center.x - tangent.x * halfWidth, y: center.y - tangent.y * halfWidth },
            p2: { x: center.x + tangent.x * halfWidth, y: center.y + tangent.y * halfWidth }
          });
        }
      }
    }
  }

  return candidates.sort((a, b) => a.gap - b.gap || b.overlap - a.overlap);
}

const RoomTemplates = {
  square: () => {
    const w = 580, h = 580;
    return {
      shape: 'square',
      vertices: [{ x: -w/2, y: -h/2 }, { x: w/2, y: -h/2 }, { x: w/2, y: h/2 }, { x: -w/2, y: h/2 }],
      sockets: [
        { x: -80, y: -h/2, normal: { x: 0, y: -1 } },
        { x: w/2, y: 70, normal: { x: 1, y: 0 } },
        { x: 60, y: h/2, normal: { x: 0, y: 1 } },
        { x: -w/2, y: -50, normal: { x: -1, y: 0 } }
      ]
    };
  },
  rect: () => {
    const w = 740, h = 480;
    return {
      shape: 'rect',
      vertices: [{ x: -w/2, y: -h/2 }, { x: w/2, y: -h/2 }, { x: w/2, y: h/2 }, { x: -w/2, y: h/2 }],
      sockets: [
        { x: -100, y: -h/2, normal: { x: 0, y: -1 } },
        { x: w/2, y: 50, normal: { x: 1, y: 0 } },
        { x: 120, y: h/2, normal: { x: 0, y: 1 } },
        { x: -w/2, y: -40, normal: { x: -1, y: 0 } }
      ]
    };
  },
  l_shape: () => {
    const w = 660, h = 660, d = 260;
    return {
      shape: 'l_shape',
      vertices: [
        { x: -w/2, y: -h/2 }, { x: -w/2 + d, y: -h/2 }, { x: -w/2 + d, y: h/2 - d },
        { x: w/2, y: h/2 - d }, { x: w/2, y: h/2 }, { x: -w/2, y: h/2 }
      ],
      sockets: [
        { x: -w/2 + d/2, y: -h/2, normal: { x: 0, y: -1 } },
        { x: w/2, y: h/2 - d/2, normal: { x: 1, y: 0 } },
        { x: -w/2, y: 0, normal: { x: -1, y: 0 } },
        { x: 0, y: h/2, normal: { x: 0, y: 1 } }
      ]
    };
  },
  pentagon: () => {
    const bw = 560, bh = 580;
    return {
      shape: 'pentagon',
      vertices: [
        { x: -bw/2, y: bh/2 }, { x: bw/2, y: bh/2 },
        { x: bw/2 + 50, y: -bh/6 }, { x: 0, y: -bh/2 }, { x: -bw/2 - 50, y: -bh/6 }
      ],
      sockets: [
        { x: 0, y: bh/2, normal: { x: 0, y: 1 } },
        { x: (bw/2 + 50) / 2, y: (-bh/6 - bh/2) / 2, normal: Vec2.normalize({ x: 1, y: -1 }) },
        { x: (-bw/2 - 50) / 2, y: (-bh/6 - bh/2) / 2, normal: Vec2.normalize({ x: -1, y: -1 }) },
        { x: bw/2 + 25, y: bh/6, normal: { x: 1, y: 0 } }
      ]
    };
  },
  triangle: () => {
    const w = 560, h = 500;
    return {
      shape: 'triangle',
      vertices: [{ x: -w/2, y: h/2 }, { x: w/2, y: h/2 }, { x: -w/2, y: -h/2 }],
      sockets: [
        { x: 30, y: h/2, normal: { x: 0, y: 1 } },
        { x: -w/2, y: -40, normal: { x: -1, y: 0 } },
        { x: 0, y: 0, normal: Vec2.normalize({ x: 1, y: -1 }) }
      ]
    };
  },
  corridor: () => {
    const len = 520, d = 240;
    return {
      shape: 'corridor',
      vertices: [{ x: -len/2, y: -d/2 }, { x: len/2, y: -d/2 }, { x: len/2, y: d/2 }, { x: -len/2, y: d/2 }],
      sockets: [
        { x: -len/2, y: 0, normal: { x: -1, y: 0 } },
        { x: len/2, y: 0, normal: { x: 1, y: 0 } },
        { x: -60, y: -d/2, normal: { x: 0, y: -1 } },
        { x: 60, y: d/2, normal: { x: 0, y: 1 } }
      ]
    };
  }
};

class MapManager {
  static createTraining() {
    // Skip the procedural constructor: previews must not alter the live Config world.
    const map = Object.create(MapManager.prototype);
    Object.assign(map, {
      isTraining: true, seed: 0x54524149, worldW: 2000, worldH: 1280,
      walls: [], doors: [], passages: [], windows: [], scrap: [], terminals: [],
      worldRooms: [], functionalRooms: [], monsterSpawns: [],
      enemyTypes: ['hunter', 'monster', 'heavy'], _layoutSignatureCache: null,
      shipHull: [{ x: 40, y: 40 }, { x: 1960, y: 40 }, { x: 1960, y: 1240 }, { x: 40, y: 1240 }],
      network: { cycles: 1, branches: 0, generationAttempt: 0, edges: [], majorRoutes: [], roomGroups: [] }
    });
    // QTE retries need randomness even though the training layout itself is fixed.
    let randomState = map.seed;
    map.random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 0x100000000;
    };
    const rectangle = (kind, trainingArea, type, label, title, x, y, w, h) => {
      const room = {
        id: map.worldRooms.length + 1, roomIndex: map.worldRooms.length,
        kind, trainingArea, type, label, title, x, y, w, h, zone: 0,
        shape: kind === 'corridor' ? 'corridor' : 'rect',
        center: { x: x + w / 2, y: y + h / 2 },
        vertices: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
        doors: [], wallSegments: [], lootPool: [], discovered: trainingArea === 'entry',
        isStart: trainingArea === 'entry', isExit: trainingArea === 'evac',
        accent: Config.roomTypes[type]?.accent || '#6f8da3',
        lights: [{ id: `training-light-${map.worldRooms.length + 1}`, state: 'normal', phase: 0,
          x1: x + 24, y1: y + 24, x2: x + w - 24, y2: y + 24, range: Math.hypot(w, h) * 1.1 }]
      };
      map.worldRooms.push(room);
      if (kind === 'room') map.functionalRooms.push(room);
      return room;
    };
    const entry = rectangle('room', 'entry', 'airlock', 'ENTRY', '基础操作区', 80, 80, 440, 480);
    const supply = rectangle('room', 'supply', 'armory', 'SUPPLY', '补给工作间', 680, 80, 640, 480);
    const hunter = rectangle('room', 'hunter', 'security_command', 'HUNTER', '射击与 Hunter 训练舱', 1480, 80, 440, 480);
    const monster = rectangle('room', 'monster', 'biolab', 'NIGHTMARE', 'Nightmare 训练区', 1480, 720, 440, 480);
    const heavy = rectangle('room', 'heavy', 'hangar_bay', 'HEAVY', 'Heavy 训练区', 680, 720, 640, 480);
    const evac = rectangle('room', 'evac', 'evacpod', 'EVAC', '终端与撤离区', 80, 720, 440, 480);
    const connect = (roomA, roomB, x, y, nx, ny) => {
      const door = {
        id: `training-door-${map.doors.length + 1}`, roomA, roomB,
        x: x - 12, y: y - 12, w: 24, h: 24,
        p1: { x: x + ny * 64, y: y - nx * 64 },
        p2: { x: x - ny * 64, y: y + nx * 64 },
        normal: { x: nx, y: ny }, axis: ny ? 'h' : 'v', isPassage: false,
        open: false, targetOpen: false, animationProgress: 0,
        openDir: 1, autoCloseTimer: 0, autoClosing: false
      };
      map.doors.push(door);
      roomA.doors.push(door);
      roomB.doors.push(door);
      return door;
    };
    for (const [a, b, x, y, w, h, nx, ny] of [
      [entry, supply, 520, 240, 160, 160, 1, 0],
      [supply, hunter, 1320, 240, 160, 160, 1, 0],
      [hunter, monster, 1620, 560, 160, 160, 0, 1],
      [heavy, monster, 1320, 880, 160, 160, 1, 0],
      [evac, heavy, 520, 880, 160, 160, 1, 0],
      [entry, evac, 220, 560, 160, 160, 0, 1]
    ]) {
      const corridor = rectangle('corridor', null, 'corridor', 'TRANSIT', '训练通道', x, y, w, h);
      corridor.corridorRole = 'segment';
      connect(a, corridor, x + (ny ? w / 2 : 0), y + (nx ? h / 2 : 0), nx, ny);
      connect(corridor, b, x + (ny ? w / 2 : w), y + (nx ? h / 2 : h), nx, ny);
    }
    map.trainingDoor = map.doors[0];

    // Training rectangles have at most one centered doorway on each edge.
    for (const room of map.worldRooms) {
      const addWall = (a, b) => {
        const wall = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        room.wallSegments.push(wall);
        map.walls.push(wall);
      };
      room.vertices.forEach((a, index) => {
        const b = room.vertices[(index + 1) % 4];
        const door = room.doors.find(item => distToSegment(
          (item.p1.x + item.p2.x) / 2, (item.p1.y + item.p2.y) / 2, a.x, a.y, b.x, b.y) < 1);
        if (!door) return addWall(a, b);
        const [near, far] = Vec2.dist(a, door.p1) < Vec2.dist(a, door.p2)
          ? [door.p1, door.p2] : [door.p2, door.p1];
        addWall(a, near);
        addWall(far, b);
      });
    }
    map.walls.push({ x: 960, y: 760, w: 80, h: 70, type: 'box', subType: 'cargo_crate' });
    map.trainingPoints = {
      move: { x: 360, y: 320 }, supply: { x: 800, y: 320 },
      firing: { x: 1560, y: 320 }, target: { x: 1730, y: 320 },
      hunterSpawn: { x: 1730, y: 320 }, monsterEntry: { x: 1680, y: 840 },
      monsterSpawn: { x: 1790, y: 1040 }, heavyEntry: { x: 1190, y: 1080 },
      heavySpawn: { x: 900, y: 960 }, evac: { x: 300, y: 960 }
    };
    map.spawnPoint = { x: 220, y: 320 };
    map.extractionPoint = { ...map.spawnPoint };
    map.exitExtractionPoint = { ...map.trainingPoints.evac };
    const trainingItems = [
      { id: 'training-part', name: '训练零件', x: 820, y: 320, shape: '1x1', size: 1, rarity: 'common' },
      { id: 'training-oxygen', itemId: 'oxygen-canister', name: '训练氧气瓶', x: 860, y: 360,
        shape: '1x2', size: 2, rarity: 'uncommon', type: 'consumable', effect: 'oxygen-50',
        image: Config.consumables.oxygenCanister.image }
      ,{ ...Config.consumables.medkit, id: 'training-medkit', itemId: 'medkit', name: '训练急救包', type: 'consumable', rarity: 'common' }
    ].map(item => ({ ...item, value: 0, found: false, roomIndex: supply.roomIndex, roomType: supply.type }));
    const trainingBox = { id: 'training-crate', x: 820, y: 400, w: 48, h: 36,
      roomIndex: supply.roomIndex, fixed: true, revision: 0, items: [] };
    const trainingGrid = new BackpackManager(6, 6);
    trainingItems.forEach(item => trainingGrid.place(item));
    trainingBox.items = trainingGrid.items;
    map.containers = [trainingBox];map.scrap = [];
    map.walls.push({ x: trainingBox.x - 24, y: trainingBox.y - 18, w: 48, h: 36,
      isBox: true, isProp: true, subType: 'loot_crate', containerId: trainingBox.id });
    map.terminals = [heavy, evac].map((room, index) => {
      const terminal = {
        id: `training-terminal-${index + 1}`, x: room.x + 120, y: room.y + room.h - 24,
        approachPoint: { x: room.x + 120, y: room.y + room.h - 88 },
        room, roomIndex: room.roomIndex, solved: false,
        sequence: index === 0 ? ['W', 'A', 'S', 'D', 'W'] : ['D', 'S', 'A', 'W', 'D']
      };
      room.terminalApproach = terminal.approachPoint;
      map.walls.push({ x: terminal.x - 16, y: terminal.y - 16, w: 32, h: 32,
        isTerminalPillar: true, terminalId: terminal.id });
      return terminal;
    });
    map.rebuildCollisionIndex();
    return map;
  }

  constructor(scaleKey = null, seed = null, difficulty = 'medium') {
    this.walls = [];
    this.doors = [];
    this.passages = [];
    this.windows = [];
    this.scrap = [];
    this.terminals = [];
    this.worldRooms = [];
    this.spawnPoint = { x: 180, y: 180 };
    this.extractionPoint = { x: 140, y: 140 };
    this.exitExtractionPoint = null;
    this.monsterSpawns = [];
    this.worldW = 3000;
    this.worldH = 3000;
    this.reset(scaleKey, seed, 0, difficulty);
  }

  /**
   * Generates a deterministic starship deck and its encounter roster.
   */
  reset(scaleKey = null, seed = null, generationAttempt = 0, difficulty = this.difficulty || 'medium') {
    this._collisionIndex = null; // Generation mutates geometry; retain exact full scans until finished.
    this._layoutSignatureCache = null;
    this.difficulty = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
    if (!scaleKey) {
      scaleKey = Config.currentScale || 'small';
    }
    const scaleConfig = (Config.mapScales && Config.mapScales[scaleKey]) || {
      id: 'small', label: '小型 (16 舱)', roomCount: 16, terminals: 3
    };
    const targetCount = scaleConfig.roomCount || 16;
    this.seed = Number.isFinite(seed) ? (seed >>> 0) : ((Math.random() * 0x100000000) >>> 0);
    let enemyState = (this.seed ^ 0x9e3779b9) >>> 0;
    enemyState = Math.imul(enemyState ^ (enemyState >>> 16), 0x7feb352d);
    enemyState = Math.imul(enemyState ^ (enemyState >>> 15), 0x846ca68b) ^ (enemyState >>> 16);
    const enemyRandom = () => {
      enemyState = (Math.imul(enemyState, 1664525) + 1013904223) >>> 0;
      return enemyState / 0x100000000;
    };
    const enemyCount = this.difficulty === 'easy' ? 2 : this.difficulty === 'hard' ? 3 : 2 + Math.floor(enemyRandom() * 2);
    const enemyPool = this.difficulty === 'easy' ? ['hunter', 'heavy'] : ['monster', 'hunter', 'heavy'];
    for (let i = enemyPool.length - 1; i > 0; i--) {
      const j = Math.floor(enemyRandom() * (i + 1));
      [enemyPool[i], enemyPool[j]] = [enemyPool[j], enemyPool[i]];
    }
    this.enemyTypes = enemyPool.slice(0, enemyCount);
    let randomState = ((this.seed + Math.imul(generationAttempt, 0x9e3779b9)) >>> 0) || 0x6d2b79f5;
    this.random = () => {
      randomState += 0x6d2b79f5;
      let value = randomState;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
    };

    this.walls = [];
    this.doors = [];
    this.passages = [];
    this.windows = [];
    this.scrap = [];
    this.containers = [];
    this.terminals = [];
    this.worldRooms = [];
    this.monsterSpawns = [];

    const functionalRooms = [];
    const corridors = [];
    const dimensions = { 16: [5, 4], 26: [6, 5], 36: [7, 6] }[targetCount];
    if (!dimensions) throw new Error(`Unsupported ship compartment count: ${targetCount}`);
    const [columns, rows] = dimensions;
    const terminalCount = scaleConfig.terminals || 3;
    const pitchX = 704 + Math.floor(this.random() * 3) * 16;
    const pitchY = 672 + Math.floor(this.random() * 3) * 16;
    const halfChannel = 80;
    const shuffle = values => {
      for (let index = values.length - 1; index > 0; index--) {
        const other = Math.floor(this.random() * (index + 1));
        [values[index], values[other]] = [values[other], values[index]];
      }
      return values;
    };
    const rectangle = (kind, x, y, w, h, type = null, label = null) => {
      const room = {
        kind, shape: kind === 'corridor' ? 'corridor' : 'rect', type, label,
        center: { x: x + w / 2, y: y + h / 2 },
        vertices: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
        doors: []
      };
      (kind === 'room' ? functionalRooms : corridors).push(room);
      return room;
    };
    const connect = (roomA, roomB, x, y, nx, ny) => {
      const isPassage = roomA.kind === 'corridor' && roomB.kind === 'corridor';
      const halfWidth = isPassage ? halfChannel : (Config.DOOR_SIZE || 128) / 2;
      const door = {
        x: x - 12, y: y - 12, w: 24, h: 24,
        p1: { x: x + ny * halfWidth, y: y - nx * halfWidth },
        p2: { x: x - ny * halfWidth, y: y + nx * halfWidth },
        normal: { x: nx, y: ny }, axis: ny ? 'h' : 'v',
        roomA, roomB, open: isPassage, targetOpen: isPassage, animationProgress: isPassage ? 1 : 0,
        openDir: 1, autoCloseTimer: 0, autoClosing: false, isPassage
      };
      (isPassage ? this.passages : this.doors).push(door);
      roomA.doors.push(door);
      roomB.doors.push(door);
    };

    // Build the circulation network first. Clipped corners leave a short bow,
    // wide midship shoulders and a flat engineering stern inside a compact hull.
    const cells = [];
    const nodes = new Map();
    const edges = new Map();
    const nodeAt = (column, row) => {
      const key = `${column}:${row}`;
      if (!nodes.has(key)) nodes.set(key, { key, x: column * pitchX, y: row * pitchY });
      return nodes.get(key);
    };
    const edgeAt = (a, b) => {
      const key = [a.key, b.key].sort().join('|');
      if (!edges.has(key)) edges.set(key, { key, a, b, active: true });
      return edges.get(key);
    };
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const endRow = row === 0 || row === rows - 1;
        if (endRow && (column === 0 || column === columns - 1 ||
            (targetCount === 36 && column === (row === 0 ? 1 : columns - 2)))) continue;
        const topLeft = nodeAt(column, row);
        const topRight = nodeAt(column + 1, row);
        const bottomRight = nodeAt(column + 1, row + 1);
        const bottomLeft = nodeAt(column, row + 1);
        cells.push({ column, row, edges: [
          edgeAt(topLeft, topRight), edgeAt(topRight, bottomRight),
          edgeAt(bottomLeft, bottomRight), edgeAt(topLeft, bottomLeft)
        ] });
      }
    }
    const nodeList = [...nodes.values()];
    const edgeList = [...edges.values()];
    const minCycles = terminalCount;
    const minBranches = (terminalCount - 1) * 2;
    const dualRoomCount = Math.ceil(targetCount * 0.6);
    const roomGroups = [];
    const networkStats = () => {
      const adjacency = new Map(nodeList.map(node => [node, []]));
      let edgeCount = 0;
      for (const edge of edgeList) {
        if (!edge.active) continue;
        edgeCount++;
        adjacency.get(edge.a).push(edge.b);
        adjacency.get(edge.b).push(edge.a);
      }
      const discovered = new Map();
      const low = new Map();
      let time = 0, bridge = false, articulation = false;
      const visit = (node, parent) => {
        discovered.set(node, ++time);
        low.set(node, time);
        let children = 0;
        for (const next of adjacency.get(node)) {
          if (next === parent) continue;
          if (!discovered.has(next)) {
            children++;
            visit(next, node);
            low.set(node, Math.min(low.get(node), low.get(next)));
            if (low.get(next) > discovered.get(node)) bridge = true;
            if (parent && low.get(next) >= discovered.get(node)) articulation = true;
          } else {
            low.set(node, Math.min(low.get(node), discovered.get(next)));
          }
        }
        if (!parent && children > 1) articulation = true;
      };
      visit(nodeList[0], null);
      const cycles = edgeCount - nodeList.length + 1;
      const branches = nodeList.filter(node => adjacency.get(node).length >= 3).length;
      const served = cells.map(cell => cell.edges.filter(edge => edge.active).length);
      return { cycles, branches, valid: discovered.size === nodeList.length && !bridge && !articulation &&
        cycles >= minCycles && branches >= minBranches && served.every(count => count > 0) &&
        served.filter(count => count >= 2).length >= dualRoomCount &&
        roomGroups.every(group => new Set(group.cells.flatMap(cell => cell.edges
          .flatMap((edge, side) => edge.active ? [side] : []))).size >= 2) };
    };

    // Reserve co-wall runs before choosing routes. Removing their separators is
    // allowed only while every lattice node remains in the biconnected core.
    const groupRange = { 16: [6, 8], 26: [9, 13], 36: [12, 18] }[targetCount];
    const groupedTarget = groupRange[0] + Math.floor(this.random() * (groupRange[1] - groupRange[0] + 1));
    const groupedCells = new Set();
    for (const first of shuffle([...cells])) {
      const remaining = groupedTarget - groupedCells.size;
      if (remaining < 2) break;
      if (groupedCells.has(first)) continue;
      const sizes = shuffle([2, 3, 4].filter(size => size <= remaining && remaining - size !== 1));
      for (const size of sizes) {
        const members = Array.from({ length: size }, (_, offset) =>
          cells.find(cell => cell.row === first.row && cell.column === first.column + offset));
        if (members.some(cell => !cell || groupedCells.has(cell))) continue;
        const separators = members.slice(0, -1).map(cell => cell.edges[1]);
        separators.forEach(edge => { edge.active = false; });
        if (!networkStats().valid) {
          separators.forEach(edge => { edge.active = true; });
          continue;
        }
        const group = { id: `group_${roomGroups.length + 1}`, cells: members, separators };
        roomGroups.push(group);
        members.forEach(cell => { groupedCells.add(cell); cell.group = group; });
        break;
      }
    }

    // Seed ordered, turning routes on the mesh, then protect them from pruning.
    // Each route keeps at least two segments that no other major route uses.
    const majorRoutes = [];
    const protectedEdges = new Set();
    for (let attempt = 0; attempt < 240 && majorRoutes.length < terminalCount; attempt++) {
      const pathNodes = [nodeList[Math.floor(this.random() * nodeList.length)]];
      const pathEdges = [];
      while (pathEdges.length < columns + rows - 1) {
        const current = pathNodes[pathNodes.length - 1];
        const choices = shuffle(edgeList.filter(edge => edge.active &&
          (edge.a === current || edge.b === current) &&
          !pathNodes.includes(edge.a === current ? edge.b : edge.a)));
        choices.sort((a, b) => Number(protectedEdges.has(a)) - Number(protectedEdges.has(b)));
        if (!choices.length) break;
        const edge = choices[0];
        pathEdges.push(edge);
        pathNodes.push(edge.a === current ? edge.b : edge.a);
      }
      if (pathEdges.length < columns + rows - 1 ||
          new Set(pathNodes.map(node => node.x)).size < 3 ||
          new Set(pathNodes.map(node => node.y)).size < 3 ||
          (majorRoutes.length && !majorRoutes.some(route => route.nodes.some(node => pathNodes.includes(node)))) ||
          pathEdges.filter(edge => !protectedEdges.has(edge)).length < 2 ||
          majorRoutes.some(route => route.edges.filter(edge => !pathEdges.includes(edge) &&
            majorRoutes.every(other => other === route || !other.edges.includes(edge))).length < 2)) continue;
      majorRoutes.push({ id: `route_${majorRoutes.length + 1}`, nodes: pathNodes, edges: pathEdges });
      pathEdges.forEach(edge => { protectedEdges.add(edge); });
    }
    const targetCycles = minCycles + Math.floor(this.random() * (terminalCount + 2));
    let stats = networkStats();
    for (const edge of shuffle([...edgeList])) {
      if (stats.cycles <= targetCycles) break;
      if (!edge.active || protectedEdges.has(edge)) continue;
      edge.active = false;
      const candidate = networkStats();
      if (candidate.valid) stats = candidate;
      else edge.active = true;
    }
    if (!stats.valid || cells.length !== targetCount || groupedCells.size < groupRange[0] ||
        majorRoutes.length !== terminalCount) {
      if (generationAttempt < 4) return this.reset(scaleKey, this.seed, generationAttempt + 1);
      throw new Error(`Could not generate a connected ship core after 5 layouts for seed ${this.seed}`);
    }
    for (const node of nodeList) {
      node.room = rectangle('corridor', node.x - halfChannel, node.y - halfChannel,
        halfChannel * 2, halfChannel * 2, 'corridor', 'TRANSIT JUNCTION');
      node.room.corridorRole = 'junction';
    }
    for (const edge of edgeList) {
      if (!edge.active) continue;
      const horizontal = edge.a.y === edge.b.y;
      edge.room = rectangle('corridor', edge.a.x + (horizontal ? halfChannel : -halfChannel),
        edge.a.y + (horizontal ? -halfChannel : halfChannel),
        horizontal ? pitchX - halfChannel * 2 : halfChannel * 2,
        horizontal ? halfChannel * 2 : pitchY - halfChannel * 2, 'corridor', 'SHIP TRANSIT');
      edge.room.corridorRole = 'segment';
      const nx = horizontal ? 1 : 0, ny = horizontal ? 0 : 1;
      connect(edge.a.room, edge.room, edge.a.x + nx * halfChannel, edge.a.y + ny * halfChannel, nx, ny);
      connect(edge.room, edge.b.room, edge.b.x - nx * halfChannel, edge.b.y - ny * halfChannel, nx, ny);
    }
    const dualCells = new Set(shuffle(cells.filter(cell => cell.edges.filter(edge => edge.active).length >= 2))
      .slice(0, dualRoomCount));
    // Reserve real polygon rooms outside shared-wall groups. The triangle and L
    // keep two adjacent full-width entrance edges, never a door on a cut corner.
    const shapedCells = new Map();
    const candidates = shuffle(cells.filter(cell => !cell.group));
    for (const shape of ['triangle', 'l_shape', 'pentagon']) {
      const cell = candidates.find(candidate => !shapedCells.has(candidate) &&
        (shape === 'pentagon' || [0, 1, 2, 3].some(rotation =>
          candidate.edges[rotation].active && candidate.edges[(rotation + 3) % 4].active)));
      if (!cell) {
        if (generationAttempt < 4) return this.reset(scaleKey, this.seed, generationAttempt + 1);
        throw new Error(`Could not reserve safe polygon compartments for seed ${this.seed}`);
      }
      const rotation = shape === 'pentagon' ? Math.floor(this.random() * 4) :
        shuffle([0, 1, 2, 3]).find(index => cell.edges[index].active && cell.edges[(index + 3) % 4].active);
      shapedCells.set(cell, { shape, rotation });
    }
    for (const cell of cells) {
      const insetX = halfChannel + 56 + Math.floor(this.random() * 3) * 16;
      const insetY = halfChannel + 56 + Math.floor(this.random() * 3) * 16;
      const joinsLeft = cell.group && cell.group.cells[0] !== cell;
      const joinsRight = cell.group && cell.group.cells[cell.group.cells.length - 1] !== cell;
      const x = cell.column * pitchX + (joinsLeft ? 0 : insetX), y = cell.row * pitchY + insetY;
      const width = pitchX - (joinsLeft ? 0 : insetX) - (joinsRight ? 0 : insetX);
      const height = pitchY - insetY * 2;
      const room = rectangle('room', x, y, width, height);
      cell.room = room;
      const shaped = shapedCells.get(cell);
      const entrances = shuffle(cell.edges.map((edge, side) => ({ edge, side })).filter(({ edge, side }) => edge.active &&
        (!shaped || shaped.shape === 'pentagon' || [shaped.rotation, (shaped.rotation + 3) % 4].includes(side))))
        .slice(0, cell.group ? 4 : shaped || dualCells.has(cell) ? 2 : 1);
      for (const { edge, side } of entrances) {
        const nx = side === 1 ? -1 : side === 3 ? 1 : 0;
        const ny = side === 0 ? 1 : side === 2 ? -1 : 0;
        const doorX = room.center.x - nx * width / 2;
        const doorY = room.center.y - ny * height / 2;
        const length = (nx ? insetX : insetY) - halfChannel;
        const accessX = doorX - nx * length, accessY = doorY - ny * length;
        const access = rectangle('corridor', nx ? Math.min(doorX, accessX) : doorX - halfChannel,
          ny ? Math.min(doorY, accessY) : doorY - halfChannel,
          nx ? length : halfChannel * 2, ny ? length : halfChannel * 2, 'corridor', 'COMPARTMENT ACCESS');
        access.corridorRole = 'access';
        connect(edge.room, access, accessX, accessY, nx, ny);
        connect(access, room, doorX, doorY, nx, ny);
      }
      if (shaped) {
        const vertices = shaped.shape === 'triangle' ? [[0, 0], [1, 0], [0, 1]] :
          shaped.shape === 'pentagon' ? [[0, 0], [1, 0], [1, 0.74], [0.74, 1], [0, 1]] :
          [[0, 0], [1, 0], [1, 0.58], [0.58, 0.58], [0.58, 1], [0, 1]];
        const transform = ([u, v]) => {
          for (let turn = 0; turn < shaped.rotation; turn++) [u, v] = [1 - v, u];
          return { x: x + u * width, y: y + v * height };
        };
        room.shape = shaped.shape;
        room.vertices = vertices.map(transform);
        room.center = transform(shaped.shape === 'pentagon' ? [0.48, 0.48] : [0.28, 0.28]);
      }
    }
    for (const group of roomGroups) {
      group.cells.forEach(cell => { cell.room.roomGroupId = group.id; });
      for (let index = 0; index < group.cells.length - 1; index++) {
        const a = group.cells[index].room, b = group.cells[index + 1].room;
        const top = Math.max(a.vertices[0].y, b.vertices[0].y);
        const bottom = Math.min(a.vertices[2].y, b.vertices[2].y);
        connect(a, b, a.vertices[1].x, (top + bottom) / 2, 1, 0);
      }
    }

    // Seeded spatial anchors make zone locations vary without altering room IDs.
    const zoneAnchors = [functionalRooms[Math.floor(this.random() * targetCount)]];
    while (zoneAnchors.length < terminalCount) {
      const remaining = shuffle(functionalRooms.filter(room => !zoneAnchors.includes(room)));
      remaining.sort((a, b) => Math.min(...zoneAnchors.map(anchor => Vec2.dist(b.center, anchor.center))) -
        Math.min(...zoneAnchors.map(anchor => Vec2.dist(a.center, anchor.center))));
      zoneAnchors.push(remaining[0]);
    }
    functionalRooms.forEach(room => {
      room.zone = zoneAnchors.reduce((best, anchor, index) =>
        Vec2.dist(room.center, anchor.center) < Vec2.dist(room.center, zoneAnchors[best].center) ? index : best, 0);
    });
    for (let zone = 0; zone < terminalCount; zone++) {
      while (functionalRooms.filter(room => room.zone === zone).length < 3) {
        const counts = zoneAnchors.map((_, index) => functionalRooms.filter(room => room.zone === index).length);
        const candidates = functionalRooms.filter(room => counts[room.zone] > 3);
        candidates.sort((a, b) => Vec2.dist(a.center, zoneAnchors[zone].center) - Vec2.dist(b.center, zoneAnchors[zone].center));
        candidates[0].zone = zone;
      }
    }
    const bowRooms = cells.filter(cell => cell.column === 0);
    const aftRooms = cells.filter(cell => cell.column === columns - 1);
    shuffle(bowRooms)[0].room.type = 'bridge';
    shuffle(aftRooms)[0].room.type = 'reactor';
    const boundaryRooms = cells.filter(cell => cell.edges.some(edge =>
      cells.filter(other => other.edges.includes(edge)).length === 1)).map(cell => cell.room).filter(room => !room.type);
    const spawnRoom = shuffle(boundaryRooms)[0];
    spawnRoom.type = 'airlock';
    const distancesFromSpawn = getRoomGraphDistances(spawnRoom);
    const evacCandidates = boundaryRooms.filter(room => room !== spawnRoom && room.zone !== spawnRoom.zone);
    shuffle(evacCandidates).sort((a, b) => distancesFromSpawn.get(b) - distancesFromSpawn.get(a));
    evacCandidates[0].type = 'evacpod';
    corridors.forEach(room => {
      room.zone = functionalRooms.reduce((nearest, candidate) =>
        Vec2.dist(room.center, candidate.center) < Vec2.dist(room.center, nearest.center) ? candidate : nearest,
      functionalRooms[0]).zone;
    });
    if (majorRoutes.some(route => new Set(route.nodes.map(node => node.room.zone)
      .concat(route.edges.map(edge => edge.room.zone))).size < 2)) {
      if (generationAttempt < 4) return this.reset(scaleKey, this.seed, generationAttempt + 1);
      throw new Error(`Could not generate cross-zone ship routes after 5 layouts for seed ${this.seed}`);
    }
    this.network = { cycles: stats.cycles, branches: stats.branches, generationAttempt,
      edges: edgeList.filter(edge => edge.active).map(edge => edge.key) };

    // Room indices stay contiguous; corridor indices follow all functional rooms.
    const airlockIndex = functionalRooms.findIndex(room => room.type === 'airlock');
    functionalRooms.unshift(functionalRooms.splice(airlockIndex, 1)[0]);
    this.functionalRooms = functionalRooms;
    const placedRooms = [...functionalRooms, ...corridors];
    placedRooms.forEach((room, index) => { room.id = index + 1; room.roomIndex = index; });
    const portals = [...this.doors, ...this.passages];
    portals.forEach(door => { door.id = `${door.isPassage ? 'passage' : 'door'}_${door.roomA.id}_${door.roomB.id}`; });
    this.network.majorRoutes = majorRoutes.map(route => {
      const routeRooms = [route.nodes[0].room];
      route.edges.forEach((edge, index) => { routeRooms.push(edge.room, route.nodes[index + 1].room); });
      routeRooms.forEach(room => { (room.majorRouteIds ||= []).push(route.id); });
      return {
        id: route.id, nodeKeys: route.nodes.map(node => node.key), edgeKeys: route.edges.map(edge => edge.key),
        uniqueEdgeKeys: route.edges.filter(edge => majorRoutes.every(other => other === route || !other.edges.includes(edge)))
          .map(edge => edge.key),
        roomIds: routeRooms.map(room => room.id),
        portalIds: routeRooms.slice(1).map((room, index) => room.doors.find(portal =>
          portal.roomA === routeRooms[index] || portal.roomB === routeRooms[index]).id),
        zones: [...new Set(routeRooms.map(room => room.zone))]
      };
    });
    this.network.roomGroups = roomGroups.map(group => {
      const members = group.cells.map(cell => cell.room);
      const internal = this.doors.filter(door => members.includes(door.roomA) && members.includes(door.roomB));
      const external = this.doors.filter(door => members.includes(door.roomA) !== members.includes(door.roomB));
      return { id: group.id, roomIds: members.map(room => room.id), doorIds: internal.map(door => door.id),
        externalDoorIds: external.map(door => door.id),
        exitDirections: [...new Set(external.map(door => {
          const room = members.includes(door.roomA) ? door.roomA : door.roomB;
          const x = (door.p1.x + door.p2.x) / 2, y = (door.p1.y + door.p2.y) / 2;
          return door.axis === 'v' ? (x < room.center.x ? 'west' : 'east') : (y < room.center.y ? 'north' : 'south');
        }))] };
    });
    const hullPoints = placedRooms.flatMap(room => room.vertices.flatMap(point => [
      { x: point.x - 64, y: point.y - 64 }, { x: point.x + 64, y: point.y + 64 }
    ]));
    hullPoints.push({ x: -halfChannel - 360, y: rows * pitchY / 2 });
    hullPoints.sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const hullHalf = points => {
      const half = [];
      for (const point of points) {
        while (half.length >= 2 && cross(half[half.length - 2], half[half.length - 1], point) <= 0) half.pop();
        half.push(point);
      }
      return half.slice(0, -1);
    };
    this.shipHull = [...hullHalf(hullPoints), ...hullHalf([...hullPoints].reverse())];

    // Shift to positive world coordinates
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    placedRooms.forEach(room => {
      room.vertices.forEach(v => {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      });
    });
    this.shipHull.forEach(point => {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    });

    const pad = 120;
    const shiftX = -minX + pad;
    const shiftY = -minY + pad;

    placedRooms.forEach(room => {
      room.center.x += shiftX;
      room.center.y += shiftY;
      room.vertices.forEach(v => {
        v.x += shiftX;
        v.y += shiftY;
      });

      let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity;
      room.vertices.forEach(v => {
        if (v.x < rMinX) rMinX = v.x;
        if (v.x > rMaxX) rMaxX = v.x;
        if (v.y < rMinY) rMinY = v.y;
        if (v.y > rMaxY) rMaxY = v.y;
      });
      room.x = rMinX;
      room.y = rMinY;
      room.w = rMaxX - rMinX;
      room.h = rMaxY - rMinY;
    });

    portals.forEach(d => {
      d.x += shiftX;
      d.y += shiftY;
      d.p1.x += shiftX;
      d.p1.y += shiftY;
      d.p2.x += shiftX;
      d.p2.y += shiftY;
    });
    this.shipHull.forEach(point => { point.x += shiftX; point.y += shiftY; });

    this.worldW = Math.ceil(maxX - minX + pad * 2);
    this.worldH = Math.ceil(maxY - minY + pad * 2);
    Config.WORLD_W = this.worldW;
    Config.WORLD_H = this.worldH;

    const airlock = functionalRooms[0];
    const exitRoom = functionalRooms.find(room => room.type === 'evacpod');

    // Functional types vary independently of the core routes and spatial zones.
    const distinctTypes = [
      'biolab', 'server', 'greenhouse', 'medbay', 'oxygen',
      'cargo', 'armory', 'workshop', 'quarters', 'waste',
      'reactor_aux', 'specimen_vault', 'quantum_core', 'hydro_arboretum',
      'cryo_stasis', 'hangar_bay', 'security_command', 'foundry',
      'officer_lounge', 'centrifuge', 'comm_array', 'observatory'
    ];
    for (let i = distinctTypes.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [distinctTypes[i], distinctTypes[j]] = [distinctTypes[j], distinctTypes[i]];
    }

    let tIdx = 0;
    placedRooms.forEach(r => {
      if (!r.type) {
        r.type = distinctTypes[tIdx % distinctTypes.length];
        tIdx++;
      }
      const def = r.type === 'oxygen' ? { ...Config.roomTypes.airlock, label: 'OXYGEN', title: '氧气供应室' } :
        Config.roomTypes[r.type] || Config.roomTypes.security_command || Config.roomTypes.reactor;
      r.label = r.kind === 'corridor' ? r.label : r.type === 'bridge' ? 'BRIDGE' : def.label;
      r.title = r.kind === 'corridor' ? '舰内通道' : r.type === 'bridge' ? '舰桥指挥舱' : def.title;
      r.accent = r.kind === 'corridor' ? '#6f8da3' : def.accent;
      r.lootPool = r.kind === 'corridor' ? [] : def.lootPool;
      r.discovered = (r.type === 'airlock');
      r.isStart = (r.type === 'airlock');
      r.isExit = (r.type === 'evacpod');
      this.worldRooms.push(r);
    });

    // Generate Wall Segments along polygon edges with deduplication
    const addWallSegment = (x1, y1, x2, y2, room) => {
      if (Math.hypot(x2 - x1, y2 - y1) < 4) return;
      room.wallSegments.push({ x1, y1, x2, y2 });
      const isDuplicate = this.walls.some(w => {
        if (w.x1 === undefined) return false;
        const dDirect = Math.hypot(w.x1 - x1, w.y1 - y1) + Math.hypot(w.x2 - x2, w.y2 - y2);
        const dRev = Math.hypot(w.x1 - x2, w.y1 - y2) + Math.hypot(w.x2 - x1, w.y2 - y1);
        return dDirect < 6 || dRev < 6;
      });
      if (!isDuplicate) {
        this.walls.push({ x1, y1, x2, y2 });
      }
    };

    placedRooms.forEach(room => {
      room.wallSegments = [];
      const v = room.vertices;
      for (let i = 0; i < v.length; i++) {
        const p1 = v[i];
        const p2 = v[(i + 1) % v.length];
        const edgeVec = Vec2.sub(p2, p1);
        const edgeLen = Math.hypot(edgeVec.x, edgeVec.y);

        // Find doors on this edge
        const edgeDoors = [];
        room.doors.forEach(d => {
          const cx = (d.p1.x + d.p2.x) / 2;
          const cy = (d.p1.y + d.p2.y) / 2;
          if (distToSegment(cx, cy, p1.x, p1.y, p2.x, p2.y) < 14) {
            const t = ((cx - p1.x) * edgeVec.x + (cy - p1.y) * edgeVec.y) / (edgeLen * edgeLen);
            edgeDoors.push({ door: d, t });
          }
        });

        if (edgeDoors.length > 0) {
          edgeDoors.sort((a, b) => a.t - b.t);
          let currP = p1;
          for (const item of edgeDoors) {
            const dP1Dist = Math.hypot(item.door.p1.x - currP.x, item.door.p1.y - currP.y);
            const dP2Dist = Math.hypot(item.door.p2.x - currP.x, item.door.p2.y - currP.y);
            const doorEntry = dP1Dist < dP2Dist ? item.door.p1 : item.door.p2;
            const doorExit = dP1Dist < dP2Dist ? item.door.p2 : item.door.p1;

            addWallSegment(currP.x, currP.y, doorEntry.x, doorEntry.y, room);
            currP = doorExit;
          }
          addWallSegment(currP.x, currP.y, p2.x, p2.y, room);
        } else {
          addWallSegment(p1.x, p1.y, p2.x, p2.y, room);
        }
      }
      room.lights = room.wallSegments.flatMap(wall => {
        const length = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
        if (length < 80) return [];
        const dx = (wall.x2 - wall.x1) / length;
        const dy = (wall.y2 - wall.y1) / length;
        return [{
          x1: wall.x1 + dx * 24 - dy * 12, y1: wall.y1 + dy * 24 + dx * 12,
          x2: wall.x2 - dx * 24 - dy * 12, y2: wall.y2 - dy * 24 + dx * 12,
          range: Math.hypot(room.w, room.h) * 1.1
        }];
      });
      // Open junctions and short access links use a ceiling strip instead of a wall strip.
      if (!room.lights.length) {
        const halfLength = Math.min(24, (room.w - 24) / 2);
        room.lights.push({ x1: room.center.x - halfLength, y1: room.center.y,
          x2: room.center.x + halfLength, y2: room.center.y, range: Math.hypot(room.w, room.h) * 1.1 });
      }
    });

    // Security Override QTE Terminals
    let candidateRooms = functionalRooms.filter(r => r.type !== 'airlock' && r.type !== 'evacpod');
    const terminalPositions = new Map();
    const terminalDistances = new Map(candidateRooms.map(room => [room, getRoomGraphDistances(room)]));
    const chosenRooms = [];
    while (chosenRooms.length < terminalCount && candidateRooms.length) {
      let bestScore = -Infinity;
      let bestRooms = [];
      candidateRooms.forEach(room => {
        const distances = terminalDistances.get(room);
        const anchors = [airlock, exitRoom, ...chosenRooms];
        const score = Math.min(...anchors.map(anchor => distances.get(anchor) ?? 0)) + (room.doors.length > 1 ? 0.25 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestRooms = [room];
        } else if (score === bestScore) {
          bestRooms.push(room);
        }
      });
      const selected = bestRooms[Math.floor(this.random() * bestRooms.length)];
      try { terminalPositions.set(selected, this.findWallMountedTerminalPos(selected)); }
      catch (error) {
        if (!error.message?.startsWith('Cannot place terminal')) throw error;
        candidateRooms = candidateRooms.filter(room => room !== selected);
        continue;
      }
      chosenRooms.push(selected);
      candidateRooms = candidateRooms.filter(room => room.zone !== selected.zone);
    }
    try {
      if (chosenRooms.length !== terminalCount) throw new Error('Cannot place one safe terminal in each ship zone');
      this.terminals = chosenRooms.map((room, idx) => {
        const pos = terminalPositions.get(room);
        room.terminalApproach = pos.approachPoint;
        // Register terminal console pillar in physical walls list
        this.walls.push({
          x: pos.x - 16,
          y: pos.y - 16,
          w: 32,
          h: 32,
          isTerminalPillar: true,
          terminalId: idx + 1
        });
        return {
          id: idx + 1,
          x: pos.x,
          y: pos.y,
          approachPoint: pos.approachPoint,
          room: room,
          solved: false,
          sequence: this.generateQTESequence(5)
        };
      });

      // Populate after mounting terminals so props and loot respect their approach lanes.
      functionalRooms.forEach(room => {
        this.populateRoom(room);
      });
    } catch (error) {
      if (!error.message?.startsWith('Cannot place ') || generationAttempt >= 4) {
        if (error.message?.startsWith('Cannot place ')) {
          throw new Error(`Could not place all ship contents after 5 deterministic layouts for seed ${this.seed}`, { cause: error });
        }
        throw error;
      }
      return this.reset(scaleKey, this.seed, generationAttempt + 1);
    }

    // Spawns
    const airlockSafe = this._findSafeRoomPoint(airlock);
    const exitSafe = this._findSafeRoomPoint(exitRoom);
    this.spawnPoint = { x: airlockSafe.x, y: airlockSafe.y };
    this.extractionPoint = { x: airlockSafe.x, y: airlockSafe.y };
    this.exitExtractionPoint = { x: exitSafe.x, y: exitSafe.y };

    // Monster spawns in distant rooms — use validated interior points (not raw center)
    functionalRooms.forEach(room => {
      if (room.type === 'airlock') return;
      if (Vec2.dist(room.center, this.spawnPoint) > 480) {
        const safePoint = this._findSafeRoomPoint(room);
        this.monsterSpawns.push(safePoint);
      }
    });
    if (this.monsterSpawns.length === 0) {
      const safePoint = this._findSafeRoomPoint(exitRoom);
      this.monsterSpawns.push(safePoint);
    }
    this._seedLights();
    this.rebuildCollisionIndex();
  }

  rebuildCollisionIndex() {
    const index = { walls: this.walls, doors: this.doors, wallCount: this.walls.length, doorCount: this.doors.length,
      buckets: new Map(), entries: [], seen: new Uint32Array(this.walls.length + this.doors.length), stamp: 0,
      result: { walls: [], doors: [] } };
    const add = (shape, door) => {
      const id = index.entries.length;
      index.entries.push({ shape, door });
      const x1 = shape.p1?.x ?? shape.x1 ?? shape.x, y1 = shape.p1?.y ?? shape.y1 ?? shape.y;
      const x2 = shape.p2?.x ?? shape.x2 ?? shape.x + shape.w, y2 = shape.p2?.y ?? shape.y2 ?? shape.y + shape.h;
      if (![x1, y1, x2, y2].every(Number.isFinite)) return;
      // Conservative padding also includes segment thickness and grid-boundary contact.
      const minX = Math.floor((Math.min(x1, x2) - 8) / 128), maxX = Math.floor((Math.max(x1, x2) + 8) / 128);
      const minY = Math.floor((Math.min(y1, y2) - 8) / 128), maxY = Math.floor((Math.max(y1, y2) + 8) / 128);
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const key = `${x},${y}`;
        if (!index.buckets.has(key)) index.buckets.set(key, []);
        index.buckets.get(key).push(id);
      }
    };
    this.walls.forEach(wall => add(wall, false));this.doors.forEach(door => add(door, true));
    this._collisionIndex = index;
  }

  _collisionCandidates(x, y, radius, dx = 0, dy = 0, distance = null) {
    let index = this._collisionIndex;
    if (!index || ![x, y, radius, dx, dy].every(Number.isFinite) || radius < 0 ||
        distance != null && (!Number.isFinite(distance) || distance < 0)) return null;
    if (index.walls !== this.walls || index.doors !== this.doors || index.wallCount !== this.walls.length || index.doorCount !== this.doors.length) {
      this.rebuildCollisionIndex();index = this._collisionIndex;
    }
    const result = index.result;result.walls.length = result.doors.length = 0;
    index.stamp = (index.stamp + 1) >>> 0;
    if (!index.stamp) { index.seen.fill(0);index.stamp = 1; }
    const visit = (cx, cy) => {
      for (const id of index.buckets.get(`${cx},${cy}`) || []) {
        if (index.seen[id] === index.stamp) continue;
        index.seen[id] = index.stamp;
        const entry = index.entries[id];result[entry.door ? 'doors' : 'walls'].push(entry.shape);
      }
    };
    if (distance == null) {
      const x0 = Math.floor((x - radius) / 128), x1 = Math.floor((x + radius) / 128);
      const y0 = Math.floor((y - radius) / 128), y1 = Math.floor((y + radius) / 128);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return null;
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) visit(cx, cy);
    } else {
      const count = Math.ceil((Math.abs(dx) + Math.abs(dy)) * distance / 128) + 3;
      if (count > 4096) return null;
      let cx = Math.floor(x / 128), cy = Math.floor(y / 128);
      const sx = Math.sign(dx), sy = Math.sign(dy), stepX = dx ? 128 / Math.abs(dx) : Infinity, stepY = dy ? 128 / Math.abs(dy) : Infinity;
      let nextX = dx ? ((cx + (dx > 0 ? 1 : 0)) * 128 - x) / dx : Infinity;
      let nextY = dy ? ((cy + (dy > 0 ? 1 : 0)) * 128 - y) / dy : Infinity;
      for (let i = 0; i < count; i++) {
        visit(cx, cy);
        const next = Math.min(nextX, nextY);
        if (next > distance || !Number.isFinite(next)) break;
        if (nextX === next) { cx += sx;nextX += stepX; }
        if (nextY === next) { cy += sy;nextY += stepY; }
      }
    }
    return result;
  }

  _seedLights() {
    let state = (this.seed ^ 0x85ebca6b) >>> 0;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    this.worldRooms.forEach(room => room.lights.forEach((light, index) => {
      const roll = random();
      light.id = `light_${room.id}_${index}`;
      light.state = roll < 0.94 ? 'normal' : roll < 0.99 ? 'flicker' : 'off';
      light.phase = random();
    }));
  }

  /**
   * Returns a point guaranteed to be inside the room polygon and not blocked.
   * Retains a grid fallback for callers supplying legacy polygon rooms.
   */
  _findSafeRoomPoint(room) {
    const pad = Config.heavy.radius;
    const hasPolygon = room.vertices && room.vertices.length >= 3;

    // Try center first
    if (hasPolygon) {
      if (pointInPolygon(room.center.x, room.center.y, room.vertices) &&
          !this.blocked(room.center.x, room.center.y, pad)) {
        return { x: room.center.x, y: room.center.y };
      }
    } else if (!this.blocked(room.center.x, room.center.y, pad)) {
      return { x: room.center.x, y: room.center.y };
    }

    // Grid search within polygon AABB
    const minX = hasPolygon ? Math.min(...room.vertices.map(v => v.x)) : room.x;
    const maxX = hasPolygon ? Math.max(...room.vertices.map(v => v.x)) : room.x + room.w;
    const minY = hasPolygon ? Math.min(...room.vertices.map(v => v.y)) : room.y;
    const maxY = hasPolygon ? Math.max(...room.vertices.map(v => v.y)) : room.y + room.h;

    for (let gx = minX + 40; gx < maxX - 40; gx += 30) {
      for (let gy = minY + 40; gy < maxY - 40; gy += 30) {
        if (hasPolygon && !pointInPolygon(gx, gy, room.vertices)) continue;
        if (this.blocked(gx, gy, pad)) continue;
        return { x: gx, y: gy };
      }
    }

    // Last resort: return center clamped to world bounds
    return {
      x: Math.max(pad, Math.min(this.worldW - pad, room.center.x)),
      y: Math.max(pad, Math.min(this.worldH - pad, room.center.y))
    };
  }

  findWallMountedTerminalPos(room) {
    const candidates = [];
    for (const wall of room.wallSegments || []) {
      const length = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
      if (length < 140) continue;
      const dx = (wall.x2 - wall.x1) / length;
      const dy = (wall.y2 - wall.y1) / length;
      for (const fraction of [0.15, 0.25, 0.35, 0.5, 0.65, 0.75, 0.85]) {
        const x = wall.x1 + dx * length * fraction - dy * 38;
        const y = wall.y1 + dy * length * fraction + dx * 38;
        const approachPoint = { x: x - dy * 68, y: y + dx * 68 };
        if (!pointInPolygon(x, y, room.vertices) || this.blocked(x, y, 18) ||
            this.scrap.some(item => Math.hypot(item.x - x, item.y - y) < 56) ||
            room.doors.some(door => {
              const cx = (door.p1.x + door.p2.x) / 2;
              const cy = (door.p1.y + door.p2.y) / 2;
              const sign = room === door.roomB ? 1 : -1;
              const ax = cx + door.normal.x * sign * (Config.heavy.radius + 18);
              const ay = cy + door.normal.y * sign * (Config.heavy.radius + 18);
              const clearance = Math.SQRT2 * (16 + Config.heavy.radius) + 8;
              return distToSegment(x, y, room.center.x, room.center.y, ax, ay) < clearance ||
                distToSegment(x, y, ax, ay, cx, cy) < clearance;
            })) continue;
        candidates.push({ x, y, wallAngle: Math.atan2(dy, dx), approachPoint });
      }
    }
    const first = Math.floor(this.random() * candidates.length);
    for (let offset = 0; offset < candidates.length; offset++) {
      const candidate = candidates[(first + offset) % candidates.length];
      if (this.isPathClear(room.center, candidate.approachPoint, Config.heavy.radius)) return candidate;
    }
    throw new Error(`Cannot place terminal in ${room.type} room`);
  }

  generateQTESequence(len = 5) {
    const keys = ['W', 'A', 'S', 'D'];
    const seq = [];
    for (let i = 0; i < len; i++) {
      seq.push(keys[Math.floor(this.random() * keys.length)]);
    }
    return seq;
  }

  getRoomAt(x, y) {
    for (let i = 0; i < this.worldRooms.length; i++) {
      const r = this.worldRooms[i];
      if (r.vertices && r.vertices.length) {
        if (pointInPolygon(x, y, r.vertices)) return r;
      } else if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
        return r;
      }
    }
    return null;
  }

  layoutSignature() {
    if (this._layoutSignatureCache) return this._layoutSignatureCache;
    const point = value => [Number(value.x.toFixed(2)), Number(value.y.toFixed(2))];
    const structure = JSON.stringify({
      rooms: this.worldRooms.map((room, index) => ({
        index, id: room.id, kind: room.kind, type: room.type, shape: room.shape, zone: room.zone,
        vertices: (room.vertices || []).map(point),
        lights: room.lights.map(light => [light.id, light.state, light.phase])
      })),
      doors: this.doors.map(door => ({
        axis: door.axis, roomA: door.roomA.id, roomB: door.roomB.id,
        p1: door.p1 && point(door.p1), p2: door.p2 && point(door.p2)
      })),
      passages: this.passages.map(passage => ({
        id: passage.id, roomA: passage.roomA.id, roomB: passage.roomB.id,
        p1: point(passage.p1), p2: point(passage.p2)
      })),
      shipHull: this.shipHull.map(point),
      majorRoutes: this.network.majorRoutes,
      roomGroups: this.network.roomGroups,
      enemyTypes: this.enemyTypes, difficulty: this.difficulty,
      containers: (this.containers || []).filter(box => box.fixed).map(box => [box.id, box.roomIndex, box.x, box.y])
    });
    let hash = 2166136261;
    for (let index = 0; index < structure.length; index++) {
      hash ^= structure.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    this._layoutSignatureCache = `${this.seed >>> 0}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
    return this._layoutSignatureCache;
  }

  roomBoundaryDistance(room, x, y, directionX, directionY) {
    if (!room) return 0;
    const vertices = room.vertices?.length
      ? room.vertices
      : [
          { x: room.x, y: room.y },
          { x: room.x + room.w, y: room.y },
          { x: room.x + room.w, y: room.y + room.h },
          { x: room.x, y: room.y + room.h }
        ];
    let nearest = Infinity;
    for (let index = 0; index < vertices.length; index++) {
      const start = vertices[index];
      const end = vertices[(index + 1) % vertices.length];
      const distance = raySegmentIntersect(x, y, directionX, directionY, start.x, start.y, end.x, end.y);
      if (distance > 1e-6 && distance < nearest) nearest = distance;
    }
    return Number.isFinite(nearest) ? nearest : 0;
  }

  tryPlaceProp(room, w, h, propType, subType, required = false) {
    const attempts = 40;
    const columns = Math.max(1, Math.floor((room.w - w - 28) / 20));
    const rows = Math.max(1, Math.floor((room.h - h - 28) / 20));
    for (let i = 0; i < attempts + (required ? columns * rows : 0); i++) {
      const rx = i < attempts ? room.center.x + (this.random() * 0.7 - 0.35) * (room.w || 500) :
        room.x + w / 2 + 14 + ((i - attempts) % columns) * 20;
      const ry = i < attempts ? room.center.y + (this.random() * 0.7 - 0.35) * (room.h || 500) :
        room.y + h / 2 + 14 + Math.floor((i - attempts) / columns) * 20;

      const x1 = rx - w / 2;
      const y1 = ry - h / 2;
      const x2 = rx + w / 2;
      const y2 = ry + h / 2;

      // Check all 4 corners + center inside room polygon
      const pts = [
        { x: x1, y: y1 }, { x: x2, y: y1 },
        { x: x2, y: y2 }, { x: x1, y: y2 },
        { x: rx, y: ry }
      ];
      if (!pts.every(p => pointInPolygon(p.x, p.y, room.vertices))) continue;

      // Safe distance from doorways
      const doorSafe = room.doors.every(d => {
        const cx = (d.p1.x + d.p2.x) / 2;
        const cy = (d.p1.y + d.p2.y) / 2;
        return Math.hypot(cx - rx, cy - ry) > 85;
      });
      if (!doorSafe) continue;

      // Keep a continuous Heavy-width lane from every doorway to the room center.
      const laneClearance = Math.hypot(w / 2 + Config.heavy.radius, h / 2 + Config.heavy.radius);
      if (room.doors.some(door => {
        const dx = (door.p1.x + door.p2.x) / 2, dy = (door.p1.y + door.p2.y) / 2;
        const direction = room === door.roomB ? 1 : -1;
        const ax = dx + door.normal.x * direction * (Config.heavy.radius + 18);
        const ay = dy + door.normal.y * direction * (Config.heavy.radius + 18);
        return distToSegment(rx, ry, room.center.x, room.center.y, ax, ay) < laneClearance ||
          distToSegment(rx, ry, ax, ay, dx, dy) < laneClearance;
      })) continue;
      if (room.terminalApproach && distToSegment(rx, ry, room.center.x, room.center.y,
        room.terminalApproach.x, room.terminalApproach.y) < laneClearance) continue;

      // Safe distance from airlock player spawn
      if (room.type === 'airlock' && Math.hypot(room.center.x - rx, room.center.y - ry) < 80) {
        continue;
      }

      // Check overlap with existing obstacles/props
      let overlaps = false;
      for (const wall of this.walls) {
        if (wall.x !== undefined) {
          if (x1 < wall.x + wall.w + 14 && x2 > wall.x - 14 &&
              y1 < wall.y + wall.h + 14 && y2 > wall.y - 14) {
            overlaps = true;
            break;
          }
        }
      }
      if (overlaps) continue;

      const propObj = {
        x: x1,
        y: y1,
        w,
        h,
        isProp: true,
        isBox: propType === 'box',
        propType,
        subType: subType || propType
      };
      this.walls.push(propObj);
      room.props = room.props || [];
      room.props.push(propObj);
      return propObj;
    }
    return null;
  }

  populateRoom(room) {
    if (room.kind === 'corridor') return;
    const boxes = [];
    const boxCount = 1 + Math.floor(this.random() * 3);
    const pool = room.lootPool || Config.roomTypes.airlock.lootPool;
    for (let index = 0; index < boxCount; index++) {
      const prop = this.tryPlaceProp(room, 48, 36, 'box', 'loot_crate', true);
      if (!prop) throw new Error(`Cannot place crate in ${room.type}`);
      const box = { id: `crate_${this.seed}_${room.id}_${index}`, roomIndex: room.roomIndex,
        x: prop.x + prop.w / 2, y: prop.y + prop.h / 2, w: prop.w, h: prop.h,
        fixed: true, revision: 0, items: [] };
      prop.containerId = box.id;
      const count = 1 + Math.floor(this.random() * 3);
      for (let itemIndex = 0; itemIndex < count; itemIndex++) {
        const template = this._chooseLootTemplateByRarity(pool);
        if (!template) throw new Error(`Cannot place loot: missing pool for ${room.type}`);
        box.items.push({ id: `${box.id}:loot:${itemIndex}`, name: template.name,
          value: template.baseValue, size: template.size, shape: template.shape,
          rarity: template.rarity, roomIndex: room.roomIndex, roomType: room.type });
      }
      boxes.push(box);
    }
    const supply = room.type === 'medbay' ? Config.consumables.medkit :
      room.type === 'oxygen' ? Config.consumables.oxygenCanister : null;
    if (supply) {
      const count = 2 + Math.floor(this.random() * 3);
      for (let index = 0; index < count; index++) boxes[index % boxes.length].items.push({
        ...supply, id: `crate_${this.seed}_${room.id}:supply:${index}`, itemId: supply.id,
        type: 'consumable', rarity: 'uncommon', roomIndex: room.roomIndex, roomType: room.type
      });
    }
    for (const box of boxes) {
      const grid = new BackpackManager(6, 6);
      const items = box.items;
      items.sort((a, b) => BackpackManager.cellCount(grid.shapeFor(b)) - BackpackManager.cellCount(grid.shapeFor(a)));
      let visits = 0;
      const pack = index => {
        if (index >= items.length) return true;
        if (++visits > 20000) return false;
        const item = items[index];
        const seen = new Set();
        for (let rot = 0; rot < 4; rot++) {
          const shape = grid.matrixFor(item, rot), key = JSON.stringify(shape);
          if (seen.has(key)) continue;
          seen.add(key);
          for (let y = 0; y <= 6 - shape.length; y++) for (let x = 0; x <= 6 - shape[0].length; x++) {
            if (visits > 20000) return false;
            if (!grid.canPlace(shape, x, y)) continue;
            if (!grid.place(item, { gx: x, gy: y, rot })) continue;
            if (pack(index + 1)) return true;
            grid.removeItem(item);
          }
        }
        return false;
      };
      if (!pack(0)) throw new Error(`Cannot place all loot in crate ${box.id}`);
      box.items = grid.items;
      this.containers.push(box);
    }

    // Searchable crates replace decorative boxes; only functional furnishings remain.
    const fixtures = {
      reactor: [72, 72, 'reactor_core'], reactor_aux: [72, 72, 'reactor_core'],
      server: [66, 26, 'server_rack'], quantum_core: [66, 26, 'server_rack'],
      biolab: [62, 30, 'lab_bench'], specimen_vault: [62, 30, 'lab_bench'],
      armory: [58, 28, 'weapon_rack'], security_command: [58, 28, 'weapon_rack'],
      greenhouse: [66, 32, 'planter_bed'], hydro_arboretum: [66, 32, 'planter_bed'],
      workshop: [62, 34, 'workbench'], foundry: [62, 34, 'workbench'],
      medbay: [56, 30, 'stasis_pod'], cryo_stasis: [56, 30, 'stasis_pod']
    };
    const [w, h, subtype] = fixtures[room.type] || [54, 28, 'machinery_unit'];
    this.tryPlaceProp(room, w, h, 'prop', subtype);
  }

  _chooseLootTemplateByRarity(pool) {
    if (!Array.isArray(pool) || !pool.length) return null;
    const weights = Config.lootRarityWeights || {};
    const availableRarities = [...new Set(pool.map(item => item.rarity))]
      .filter(rarity => Number(weights[rarity]) > 0);
    const totalWeight = availableRarities.reduce((total, rarity) => total + Number(weights[rarity]), 0);
    if (!totalWeight) return null;

    const roll = this.random() * totalWeight;
    let cumulativeWeight = 0;
    let selectedRarity = availableRarities[availableRarities.length - 1];
    for (const rarity of availableRarities) {
      cumulativeWeight += Number(weights[rarity]);
      if (roll < cumulativeWeight) {
        selectedRarity = rarity;
        break;
      }
    }

    const candidates = pool.filter(item => item.rarity === selectedRarity);
    if (candidates.length === 1) return candidates[0];
    return candidates[Math.floor(this.random() * candidates.length)] || null;
  }

  toggleDoor(door, playerX, playerY) {
    if (door.isPassage) return { open: true, dir: 0 };
    const targetOpen = !(door.targetOpen ?? door.open);
    if (targetOpen) {
      const cx = (door.p1 && door.p2) ? (door.p1.x + door.p2.x) / 2 : (door.x + door.w / 2);
      const cy = (door.p1 && door.p2) ? (door.p1.y + door.p2.y) / 2 : (door.y + door.h / 2);
      if (door.axis === 'h') {
        door.openDir = (playerY < cy) ? 1 : -1;
      } else {
        door.openDir = (playerX < cx) ? 1 : -1;
      }
      door.openDir = door.openDir || 1;
    }
    door.targetOpen = targetOpen;
    door.autoCloseTimer = 0;
    door.autoClosing = false;
    if (!Number.isFinite(door.animationProgress)) door.animationProgress = door.open ? 1 : 0;
    return { open: targetOpen, dir: targetOpen ? door.openDir : 0 };
  }

  advanceDoorAnimations(dt, players = [], blockingActors = [], authoritative = true) {
    const events = [];
    const elapsed = Math.max(0, Number.isFinite(dt) ? dt : 0);
    const step = elapsed / 0.35;
    const hasPosition = actor => actor && Number.isFinite(actor.x) && Number.isFinite(actor.y);
    const activePlayers = players.filter(player => hasPosition(player) && player.online !== false);
    const aliveActors = blockingActors.filter(actor => hasPosition(actor) && actor.alive !== false && !actor.dead);
    const nearbyActors = [...activePlayers, ...aliveActors];

    this.doors.forEach(door => {
      if (!Number.isFinite(door.animationProgress)) door.animationProgress = door.open ? 1 : 0;
      if (typeof door.targetOpen !== 'boolean') door.targetOpen = !!door.open;

      if (authoritative) {
        if (!Number.isFinite(door.autoCloseTimer)) door.autoCloseTimer = 0;
        const nearby = nearbyActors.some(actor => {
          const radius = Number.isFinite(actor.radius) ? actor.radius : Config.player.radius;
          return door.p1 && door.p2
            ? distToSegment(actor.x, actor.y, door.p1.x, door.p1.y, door.p2.x, door.p2.y) <= 80 + radius
            : this._doorBlocksPoint(door, actor.x, actor.y, 80 + radius);
        });
        if (door.autoClosing && nearby) {
          door.targetOpen = true;
          door.autoClosing = false;
          door.autoCloseTimer = 0;
          events.push({ door, autoReopened: true });
        }
        if (door.open && door.targetOpen && door.animationProgress >= 1) {
          door.autoCloseTimer = nearby ? 0 : door.autoCloseTimer + elapsed;
          if (door.autoCloseTimer >= 5) {
            door.targetOpen = false;
            door.autoClosing = true;
            door.autoCloseTimer = 0;
            events.push({ door, autoClosed: true });
            return;
          }
        } else {
          door.autoCloseTimer = 0;
        }
      }

      const target = door.targetOpen ? 1 : 0;
      door.animationProgress += Math.sign(target - door.animationProgress) * Math.min(step, Math.abs(target - door.animationProgress));
      if (!authoritative) return;

      if (door.targetOpen && door.animationProgress >= 1) {
        door.animationProgress = 1;
        door.open = true;
      } else if (!door.targetOpen && door.animationProgress <= 0 && door.open) {
        const clearancePlan = this.planDoorwayClearance(door, activePlayers);
        const otherOccupant = aliveActors.some(actor =>
          this._doorBlocksPoint(door, actor.x, actor.y, Number.isFinite(actor.radius) ? actor.radius : 0));

        if (clearancePlan === null || otherOccupant) {
          door.targetOpen = true;
          door.animationProgress = 0;
          door.autoClosing = false;
          door.autoCloseTimer = 0;
          events.push({ door, blocked: true });
          return;
        }

        clearancePlan.forEach(move => {
          move.player.x = move.x;
          move.player.y = move.y;
        });
        door.animationProgress = 0;
        door.open = false;
        door.autoClosing = false;
        door.autoCloseTimer = 0;
      }
    });

    return events;
  }

  _doorBlocksPoint(door, x, y, padding) {
    if (door.p1 && door.p2) {
      return distToSegment(x, y, door.p1.x, door.p1.y, door.p2.x, door.p2.y) < padding + 8;
    }
    if (door.x !== undefined) {
      return x > door.x - padding && x < door.x + door.w + padding &&
        y > door.y - padding && y < door.y + door.h + padding;
    }
    return false;
  }

  planDoorwayClearance(door, players = []) {
    if (!door || !door.open || !Array.isArray(players)) return [];
    const actors = [...new Set(players.filter(player => player && Number.isFinite(player.x) && Number.isFinite(player.y)))];
    const radiusFor = player => Number.isFinite(player.radius) ? player.radius : Config.player.radius;
    const occupants = actors.filter(player => this._doorBlocksPoint(door, player.x, player.y, radiusFor(player)));
    if (!occupants.length) return [];

    const centerX = door.p1 && door.p2 ? (door.p1.x + door.p2.x) / 2 : door.x + door.w / 2;
    const centerY = door.p1 && door.p2 ? (door.p1.y + door.p2.y) / 2 : door.y + door.h / 2;
    let normalX = door.normal && Number.isFinite(door.normal.x) ? door.normal.x : (door.axis === 'v' ? 1 : 0);
    let normalY = door.normal && Number.isFinite(door.normal.y) ? door.normal.y : (door.axis === 'h' ? 1 : 0);
    const normalLength = Math.hypot(normalX, normalY);
    if (normalLength < 0.001) return null;
    normalX /= normalLength;
    normalY /= normalLength;

    const occupantSet = new Set(occupants);
    const moves = [];
    const assignNext = index => {
      if (index >= occupants.length) return true;
      const actor = occupants[index];
      const radius = radiusFor(actor);
      const sideDistance = (actor.x - centerX) * normalX + (actor.y - centerY) * normalY;
      const preferredSide = Math.abs(sideDistance) < 0.001 ? -1 : Math.sign(sideDistance);
      const initialOffset = door.p1 && door.p2
        ? radius + 12
        : radius + (door.axis === 'v' ? door.w / 2 : door.h / 2) + 4;
      const candidates = [];

      for (const side of [preferredSide, -preferredSide]) {
        for (const distance of [0, 12, 24, 36, 48].map(offset => initialOffset + offset)) {
          const x = centerX + normalX * side * distance;
          const y = centerY + normalY * side * distance;
          candidates.push({
            x,
            y,
            side,
            travel: Math.hypot(x - actor.x, y - actor.y)
          });
        }
      }
      candidates.sort((a, b) => a.travel - b.travel || (a.side === b.side ? 0 : a.side === preferredSide ? -1 : 1));

      for (const candidate of candidates) {
        if (this._doorBlocksPoint(door, candidate.x, candidate.y, radius) ||
            this.blocked(candidate.x, candidate.y, radius)) continue;

        const overlapsPlayer = actors.some(other => {
          if (other === actor) return false;
          const planned = moves.find(move => move.player === other);
          if (!planned && occupantSet.has(other)) return false;
          const otherX = planned ? planned.x : other.x;
          const otherY = planned ? planned.y : other.y;
          return Math.hypot(candidate.x - otherX, candidate.y - otherY) < radius + radiusFor(other) + 2;
        });
        if (overlapsPlayer) continue;

        moves.push({ player: actor, x: candidate.x, y: candidate.y });
        if (assignNext(index + 1)) return true;
        moves.pop();
      }
      return false;
    };

    return assignNext(0) ? moves : null;
  }

  isPathClear(from, to, radius = 22, ignoreDoors = false) {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 8));
    for (let index = 0; index <= steps; index++) {
      const fraction = index / steps;
      if (this.blocked(from.x + (to.x - from.x) * fraction,
        from.y + (to.y - from.y) * fraction, radius, ignoreDoors)) return false;
    }
    return true;
  }

  blocked(x, y, padding = 10, ignoreDoors = false, ignoreMovementBarriers = false) {
    if (!ignoreMovementBarriers && this.movementBarrierAt?.(x, y, padding)) return true;
    // 1. World outer boundary limit
    if (x < padding || x > (this.worldW ?? Config.WORLD_W) - padding ||
        y < padding || y > (this.worldH ?? Config.WORLD_H) - padding) {
      return true;
    }

    const candidates = this._collisionCandidates(x, y, padding);
    const doors = candidates?.doors || this.doors, walls = candidates?.walls || this.walls;
    // 2. Closed doors physically block movement
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (!ignoreDoors && !d.open && this._doorBlocksPoint(d, x, y, padding)) return true;
    }

    // 3. Walls (line segments and AABB obstacles)
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (w.x1 !== undefined) {
        if (distToSegment(x, y, w.x1, w.y1, w.x2, w.y2) < padding + 8) {
          return true;
        }
      } else if (w.x !== undefined) {
        if (x > w.x - padding && x < w.x + w.w + padding && 
            y > w.y - padding && y < w.y + w.h + padding) {
          return true;
        }
      }
    }

    return false;
  }

  rayWallDistance(originX, originY, directionX, directionY, maxDistance) {
    let nearest = maxDistance;
    const candidates = this._collisionCandidates(originX, originY, 0, directionX, directionY, maxDistance);
    const walls = candidates?.walls || this.walls, doors = candidates?.doors || this.doors;

    // Walls
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (w.x1 !== undefined) {
        const d = raySegmentIntersect(originX, originY, directionX, directionY, w.x1, w.y1, w.x2, w.y2);
        if (d < nearest) nearest = d;
      } else if (w.x !== undefined) {
        const invX = directionX === 0 ? 1e9 : 1 / directionX;
        const invY = directionY === 0 ? 1e9 : 1 / directionY;
        const t1 = (w.x - originX) * invX;
        const t2 = (w.x + w.w - originX) * invX;
        const t3 = (w.y - originY) * invY;
        const t4 = (w.y + w.h - originY) * invY;
        const near = Math.max(Math.min(t1, t2), Math.min(t3, t4));
        const far = Math.min(Math.max(t1, t2), Math.max(t3, t4));
        if (far >= Math.max(0, near) && near < nearest) {
          nearest = Math.max(0, near);
        }
      }
    }

    // Closed doors
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (d.open) continue;
      if (d.p1 && d.p2) {
        const dist = raySegmentIntersect(originX, originY, directionX, directionY, d.p1.x, d.p1.y, d.p2.x, d.p2.y);
        if (dist < nearest) nearest = dist;
      } else if (d.x !== undefined) {
        const invX = directionX === 0 ? 1e9 : 1 / directionX;
        const invY = directionY === 0 ? 1e9 : 1 / directionY;
        const t1 = (d.x - originX) * invX;
        const t2 = (d.x + d.w - originX) * invX;
        const t3 = (d.y - originY) * invY;
        const t4 = (d.y + d.h - originY) * invY;
        const near = Math.max(Math.min(t1, t2), Math.min(t3, t4));
        const far = Math.min(Math.max(t1, t2), Math.max(t3, t4));
        if (far >= Math.max(0, near) && near < nearest) {
          nearest = Math.max(0, near);
        }
      }
    }

    return nearest;
  }

  rayVisionDistance(originX, originY, directionX, directionY, maxDistance, wallReveal = 12) {
    let nearestEntry = maxDistance;
    let visibleEnd = maxDistance;

    // Walls
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      if (w.x1 !== undefined) {
        const d = raySegmentIntersect(originX, originY, directionX, directionY, w.x1, w.y1, w.x2, w.y2);
        if (d < nearestEntry) {
          nearestEntry = d;
          visibleEnd = d + Math.min(wallReveal, 8);
        }
      } else if (w.x !== undefined) {
        const invX = directionX === 0 ? 1e9 : 1 / directionX;
        const invY = directionY === 0 ? 1e9 : 1 / directionY;
        const t1 = (w.x - originX) * invX;
        const t2 = (w.x + w.w - originX) * invX;
        const t3 = (w.y - originY) * invY;
        const t4 = (w.y + w.h - originY) * invY;
        const near = Math.max(Math.min(t1, t2), Math.min(t3, t4));
        const far = Math.min(Math.max(t1, t2), Math.max(t3, t4));
        if (far >= Math.max(0, near) && near < nearestEntry) {
          nearestEntry = Math.max(0, near);
          visibleEnd = far;
        }
      }
    }

    // Closed doors
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      if (d.open) continue;
      if (d.p1 && d.p2) {
        const dist = raySegmentIntersect(originX, originY, directionX, directionY, d.p1.x, d.p1.y, d.p2.x, d.p2.y);
        if (dist < nearestEntry) {
          nearestEntry = dist;
          visibleEnd = dist + Math.min(wallReveal, 8);
        }
      } else if (d.x !== undefined) {
        const invX = directionX === 0 ? 1e9 : 1 / directionX;
        const invY = directionY === 0 ? 1e9 : 1 / directionY;
        const t1 = (d.x - originX) * invX;
        const t2 = (d.x + d.w - originX) * invX;
        const t3 = (d.y - originY) * invY;
        const t4 = (d.y + d.h - originY) * invY;
        const near = Math.max(Math.min(t1, t2), Math.min(t3, t4));
        const far = Math.min(Math.max(t1, t2), Math.max(t3, t4));
        if (far >= Math.max(0, near) && near < nearestEntry) {
          nearestEntry = Math.max(0, near);
          visibleEnd = far;
        }
      }
    }

    if (nearestEntry >= maxDistance) return maxDistance;
    return Math.min(maxDistance, visibleEnd);
  }
}
