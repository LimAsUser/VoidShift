/**
 * VOID SHIFT // RECOVERY OPERATIONS PROTOCOL
 * Organic Modular Procedural Facility Architecture
 * Generates arbitrary polygon chamber networks (Squares, Rectangles, L-shapes, Pentagons, Triangles, Corridors)
 * Connected door-to-door with SAT collision verification & precise segment raycasting/physics.
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
  constructor() {
    this.walls = [];
    this.doors = [];
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
    this.reset();
  }

  /**
   * Generates a completely new organic modular procedural facility layout
   */
  reset(scaleKey = null) {
    if (!scaleKey) {
      scaleKey = Config.currentScale || 'small';
    }
    const scaleConfig = (Config.mapScales && Config.mapScales[scaleKey]) || {
      id: 'small', label: '小型 (12 舱)', roomCount: 12, terminals: 3
    };
    const targetCount = scaleConfig.roomCount || 12;

    this.walls = [];
    this.doors = [];
    this.windows = [];
    this.scrap = [];
    this.terminals = [];
    this.worldRooms = [];
    this.monsterSpawns = [];

    const templateKeys = ['square', 'rect', 'l_shape', 'pentagon', 'triangle', 'corridor'];
    let placedRooms = null;

    for (let attempt = 0; attempt < 50; attempt++) {
      const rootTpl = RoomTemplates.square();
      const rootRoom = {
        id: 1,
        shape: 'square',
        center: { x: 0, y: 0 },
        vertices: rootTpl.vertices.map(v => ({ x: v.x, y: v.y })),
        doors: []
      };

      const currentRooms = [rootRoom];
      const openSockets = rootTpl.sockets.map(s => ({
        room: rootRoom,
        worldPos: { x: s.x, y: s.y },
        normal: { ...s.normal }
      }));

      let steps = 0;
      while (currentRooms.length < targetCount && openSockets.length > 0 && steps < 500) {
        steps++;
        const sockIdx = Math.floor(Math.random() * openSockets.length);
        const parentSock = openSockets[sockIdx];

        // Equal probability shape selection (same prob): choose least used shapes with slight jitter
        const counts = {};
        templateKeys.forEach(k => counts[k] = 0);
        currentRooms.forEach(r => { if (counts[r.shape] !== undefined) counts[r.shape]++; });
        const sortedKeys = [...templateKeys].sort((a, b) => (counts[a] - counts[b]) + (Math.random() * 0.5 - 0.25));
        const shapeKey = sortedKeys[0];
        const tpl = RoomTemplates[shapeKey]();

        let placed = false;
        const candSocketIndices = Array.from({ length: tpl.sockets.length }, (_, i) => i);
        for (let i = candSocketIndices.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [candSocketIndices[i], candSocketIndices[j]] = [candSocketIndices[j], candSocketIndices[i]];
        }

        for (const sIdx of candSocketIndices) {
          const candSock = tpl.sockets[sIdx];
          const targetAngle = Math.atan2(-parentSock.normal.y, -parentSock.normal.x);
          const candAngle = Math.atan2(candSock.normal.y, candSock.normal.x);
          const rotAngle = targetAngle - candAngle;

          const rotatedCandPos = Vec2.rotate({ x: candSock.x, y: candSock.y }, rotAngle);
          const worldCenter = Vec2.sub(parentSock.worldPos, rotatedCandPos);

          const candidateWorldVertices = tpl.vertices.map(v => {
            const rot = Vec2.rotate(v, rotAngle);
            return Vec2.add(worldCenter, rot);
          });

          let collides = false;
          for (const existing of currentRooms) {
            if (polygonSAT(candidateWorldVertices, existing.vertices)) {
              collides = true;
              break;
            }
          }

          if (!collides) {
            const newRoom = {
              id: currentRooms.length + 1,
              shape: shapeKey,
              center: worldCenter,
              vertices: candidateWorldVertices,
              doors: []
            };

            const doorWidth = 64;
            const doorTangent = { x: -parentSock.normal.y, y: parentSock.normal.x };
            const p1 = {
              x: parentSock.worldPos.x - doorTangent.x * doorWidth / 2,
              y: parentSock.worldPos.y - doorTangent.y * doorWidth / 2
            };
            const p2 = {
              x: parentSock.worldPos.x + doorTangent.x * doorWidth / 2,
              y: parentSock.worldPos.y + doorTangent.y * doorWidth / 2
            };

            const doorObj = {
              id: `door_${parentSock.room.id}_${newRoom.id}`,
              x: (p1.x + p2.x) / 2 - 12,
              y: (p1.y + p2.y) / 2 - 12,
              w: 24,
              h: 24,
              p1,
              p2,
              normal: parentSock.normal,
              axis: Math.abs(parentSock.normal.y) > 0.5 ? 'h' : 'v',
              roomA: parentSock.room,
              roomB: newRoom,
              open: false,
              openDir: 1
            };

            this.doors.push(doorObj);
            parentSock.room.doors.push(doorObj);
            newRoom.doors.push(doorObj);

            currentRooms.push(newRoom);
            openSockets.splice(sockIdx, 1);

            for (let k = 0; k < tpl.sockets.length; k++) {
              if (k !== sIdx) {
                const s = tpl.sockets[k];
                const worldS = Vec2.add(worldCenter, Vec2.rotate({ x: s.x, y: s.y }, rotAngle));
                const normS = Vec2.rotate(s.normal, rotAngle);
                openSockets.push({
                  room: newRoom,
                  worldPos: worldS,
                  normal: normS
                });
              }
            }

            placed = true;
            break;
          }
        }

        if (!placed) {
          openSockets.splice(sockIdx, 1);
        }
      }

      if (currentRooms.length === targetCount) {
        placedRooms = currentRooms;
        break;
      }
    }

    if (!placedRooms) {
      throw new Error(`Failed to generate organic station of ${targetCount} rooms`);
    }

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

    this.doors.forEach(d => {
      d.x += shiftX;
      d.y += shiftY;
      d.p1.x += shiftX;
      d.p1.y += shiftY;
      d.p2.x += shiftX;
      d.p2.y += shiftY;
    });

    this.worldW = Math.ceil(maxX - minX + pad * 2);
    this.worldH = Math.ceil(maxY - minY + pad * 2);
    Config.WORLD_W = this.worldW;
    Config.WORLD_H = this.worldH;

    // Airlock at root
    const airlock = placedRooms[0];
    airlock.type = 'airlock';

    // Evac Pod furthest from Airlock
    let maxDist = -1;
    let exitRoom = placedRooms[1];
    placedRooms.forEach(r => {
      if (r === airlock) return;
      const d = Vec2.dist(airlock.center, r.center);
      if (d > maxDist) {
        maxDist = d;
        exitRoom = r;
      }
    });
    exitRoom.type = 'evacpod';

    // 22 Distinct Functional Room Types Pool
    const distinctTypes = [
      'reactor', 'biolab', 'server', 'greenhouse', 'medbay',
      'cargo', 'armory', 'workshop', 'quarters', 'waste',
      'reactor_aux', 'specimen_vault', 'quantum_core', 'hydro_arboretum',
      'cryo_stasis', 'hangar_bay', 'security_command', 'foundry',
      'officer_lounge', 'centrifuge', 'comm_array', 'observatory'
    ];
    for (let i = distinctTypes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [distinctTypes[i], distinctTypes[j]] = [distinctTypes[j], distinctTypes[i]];
    }

    let tIdx = 0;
    placedRooms.forEach(r => {
      if (r !== airlock && r !== exitRoom) {
        r.type = distinctTypes[tIdx % distinctTypes.length];
        tIdx++;
      }
      const def = Config.roomTypes[r.type] || Config.roomTypes.reactor;
      r.label = def.label;
      r.title = def.title;
      r.accent = def.accent;
      r.lootPool = def.lootPool;
      r.discovered = (r.type === 'airlock');
      r.isStart = (r.type === 'airlock');
      r.isExit = (r.type === 'evacpod');
      this.worldRooms.push(r);
    });

    // Generate Wall Segments along polygon edges with deduplication
    const addWallSegment = (x1, y1, x2, y2) => {
      if (Math.hypot(x2 - x1, y2 - y1) < 4) return;
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

            addWallSegment(currP.x, currP.y, doorEntry.x, doorEntry.y);
            currP = doorExit;
          }
          addWallSegment(currP.x, currP.y, p2.x, p2.y);
        } else {
          addWallSegment(p1.x, p1.y, p2.x, p2.y);
        }
      }
    });

    // Populate interior structures & scrap per room
    placedRooms.forEach(room => {
      this.populateRoom(room);
    });

    // Spawns
    this.spawnPoint = { x: airlock.center.x, y: airlock.center.y };
    this.extractionPoint = { x: airlock.center.x + 35, y: airlock.center.y + 35 };
    this.exitExtractionPoint = { x: exitRoom.center.x, y: exitRoom.center.y };

    // Monster spawns in distant rooms
    placedRooms.forEach(room => {
      if (room.type === 'airlock') return;
      if (Vec2.dist(room.center, this.spawnPoint) > 480) {
        this.monsterSpawns.push({ x: room.center.x, y: room.center.y });
      }
    });
    if (this.monsterSpawns.length === 0) {
      this.monsterSpawns.push({ x: exitRoom.center.x, y: exitRoom.center.y });
    }

    // Security Override QTE Terminals
    const candidateRooms = placedRooms.filter(r => r.type !== 'airlock' && r.type !== 'evacpod');
    for (let i = candidateRooms.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidateRooms[i], candidateRooms[j]] = [candidateRooms[j], candidateRooms[i]];
    }
    const terminalCount = scaleConfig.terminals || 3;
    const chosenRooms = candidateRooms.slice(0, terminalCount);
    this.terminals = chosenRooms.map((room, idx) => {
      const pos = this.findWallMountedTerminalPos(room);
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
        room: room,
        solved: false,
        sequence: this.generateQTESequence(5)
      };
    });
  }

  /**
   * Finds a safe wall-mounted or pillar-mounted position strictly inside the room polygon
   */
  findWallMountedTerminalPos(room) {
    if (!room.vertices || room.vertices.length < 3) {
      return { x: room.center.x, y: room.center.y };
    }

    const n = room.vertices.length;
    const candidates = [];

    // Loop over each perimeter wall polygon edge
    for (let i = 0; i < n; i++) {
      const v1 = room.vertices[i];
      const v2 = room.vertices[(i + 1) % n];
      const edgeLen = Math.hypot(v2.x - v1.x, v2.y - v1.y);
      if (edgeLen < 100) continue;

      const mx = (v1.x + v2.x) / 2;
      const my = (v1.y + v2.y) / 2;
      const dx = (v2.x - v1.x) / edgeLen;
      const dy = (v2.y - v1.y) / edgeLen;

      // Inward normal candidates (+90 or -90 deg)
      const n1 = { x: -dy, y: dx };
      const n2 = { x: dy, y: -dx };
      const inwardDist = 38;

      let inwardNormal = null;
      if (pointInPolygon(mx + n1.x * inwardDist, my + n1.y * inwardDist, room.vertices)) {
        inwardNormal = n1;
      } else if (pointInPolygon(mx + n2.x * inwardDist, my + n2.y * inwardDist, room.vertices)) {
        inwardNormal = n2;
      }

      if (!inwardNormal) continue;

      const pos = {
        x: Math.round(mx + inwardNormal.x * inwardDist),
        y: Math.round(my + inwardNormal.y * inwardDist),
        wallAngle: Math.atan2(dy, dx)
      };

      // Check distance from doors
      const nearDoor = this.doors.some(d => {
        const dX = d.x !== undefined ? d.x : (d.p1 ? (d.p1.x + d.p2.x) / 2 : 0);
        const dY = d.y !== undefined ? d.y : (d.p1 ? (d.p1.y + d.p2.y) / 2 : 0);
        return Math.hypot(pos.x - dX, pos.y - dY) < 95;
      });

      if (!nearDoor && pointInPolygon(pos.x, pos.y, room.vertices)) {
        candidates.push(pos);
      }
    }

    if (candidates.length > 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    // Fallback: Grid search inside the room polygon for a safe interior location
    let bestPoint = null;
    let maxDistToWalls = -1;
    const minX = Math.min(...room.vertices.map(v => v.x));
    const maxX = Math.max(...room.vertices.map(v => v.x));
    const minY = Math.min(...room.vertices.map(v => v.y));
    const maxY = Math.max(...room.vertices.map(v => v.y));

    for (let gx = minX + 50; gx <= maxX - 50; gx += 30) {
      for (let gy = minY + 50; gy <= maxY - 50; gy += 30) {
        if (pointInPolygon(gx, gy, room.vertices)) {
          let distToEdge = Infinity;
          for (let i = 0; i < n; i++) {
            const v1 = room.vertices[i];
            const v2 = room.vertices[(i + 1) % n];
            distToEdge = Math.min(distToEdge, distToSegment(gx, gy, v1.x, v1.y, v2.x, v2.y));
          }
          if (distToEdge > maxDistToWalls && distToEdge > 35) {
            maxDistToWalls = distToEdge;
            bestPoint = { x: gx, y: gy };
          }
        }
      }
    }

    return bestPoint || { x: room.center.x, y: room.center.y };
  }

  generateQTESequence(len = 5) {
    const keys = ['W', 'A', 'S', 'D'];
    const seq = [];
    for (let i = 0; i < len; i++) {
      seq.push(keys[Math.floor(Math.random() * keys.length)]);
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

  tryPlaceProp(room, w, h, propType, subType) {
    const attempts = 40;
    for (let i = 0; i < attempts; i++) {
      const rx = room.center.x + (Math.random() * 0.7 - 0.35) * (room.w || 500);
      const ry = room.center.y + (Math.random() * 0.7 - 0.35) * (room.h || 500);

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
    // 1. Place thematic props & cargo boxes
    if (room.type === 'airlock') {
      this.tryPlaceProp(room, 38, 38, 'box', 'supply_crate');
      this.tryPlaceProp(room, 38, 38, 'box', 'supply_crate');
    } else if (room.type === 'reactor' || room.type === 'reactor_aux') {
      this.tryPlaceProp(room, 72, 72, 'prop', 'reactor_core');
      this.tryPlaceProp(room, 36, 36, 'box', 'coolant_cell');
      this.tryPlaceProp(room, 36, 36, 'box', 'coolant_cell');
    } else if (room.type === 'server' || room.type === 'quantum_core') {
      this.tryPlaceProp(room, 66, 26, 'prop', 'server_rack');
      this.tryPlaceProp(room, 66, 26, 'prop', 'server_rack');
      this.tryPlaceProp(room, 36, 36, 'box', 'storage_box');
    } else if (room.type === 'cargo' || room.type === 'hangar_bay') {
      this.tryPlaceProp(room, 54, 40, 'box', 'cargo_crate');
      this.tryPlaceProp(room, 46, 36, 'box', 'cargo_crate');
      this.tryPlaceProp(room, 40, 40, 'box', 'cargo_crate');
      this.tryPlaceProp(room, 36, 36, 'box', 'cargo_crate');
    } else if (room.type === 'biolab' || room.type === 'specimen_vault') {
      this.tryPlaceProp(room, 62, 30, 'prop', 'lab_bench');
      this.tryPlaceProp(room, 40, 40, 'box', 'specimen_pod');
      this.tryPlaceProp(room, 36, 36, 'box', 'storage_box');
    } else if (room.type === 'armory' || room.type === 'security_command') {
      this.tryPlaceProp(room, 58, 28, 'prop', 'weapon_rack');
      this.tryPlaceProp(room, 38, 38, 'box', 'ammo_crate');
      this.tryPlaceProp(room, 38, 38, 'box', 'ammo_crate');
    } else if (room.type === 'greenhouse' || room.type === 'hydro_arboretum') {
      this.tryPlaceProp(room, 66, 32, 'prop', 'planter_bed');
      this.tryPlaceProp(room, 66, 32, 'prop', 'planter_bed');
      this.tryPlaceProp(room, 36, 36, 'box', 'storage_box');
    } else if (room.type === 'workshop' || room.type === 'foundry') {
      this.tryPlaceProp(room, 62, 34, 'prop', 'workbench');
      this.tryPlaceProp(room, 42, 42, 'box', 'tool_chest');
      this.tryPlaceProp(room, 38, 38, 'box', 'cargo_crate');
    } else if (room.type === 'medbay' || room.type === 'cryo_stasis') {
      this.tryPlaceProp(room, 56, 30, 'prop', 'stasis_pod');
      this.tryPlaceProp(room, 38, 38, 'box', 'med_crate');
      this.tryPlaceProp(room, 34, 34, 'box', 'storage_box');
    } else {
      this.tryPlaceProp(room, 44, 44, 'box', 'cargo_crate');
      this.tryPlaceProp(room, 40, 40, 'box', 'storage_box');
      this.tryPlaceProp(room, 54, 28, 'prop', 'machinery_unit');
    }

    // 2. Generate 2 to 3 themed scrap items
    const pool = room.lootPool || Config.roomTypes.reactor.lootPool;
    const scrapCount = room.type === 'airlock' ? 2 : 3;

    for (let i = 0; i < scrapCount; i++) {
      const lootTemplate = pool[Math.floor(Math.random() * pool.length)];
      let valid = false;
      let sx = 0, sy = 0;
      let attempts = 0;

      while (!valid && attempts < 35) {
        attempts++;
        const angle = Math.random() * Math.PI * 2;
        const rad = 40 + Math.random() * 110;
        sx = room.center.x + Math.cos(angle) * rad;
        sy = room.center.y + Math.sin(angle) * rad;

        if (pointInPolygon(sx, sy, room.vertices) && !this.blocked(sx, sy, 22)) {
          const nearDoor = room.doors.some(d => {
            const cx = (d.p1.x + d.p2.x) / 2;
            const cy = (d.p1.y + d.p2.y) / 2;
            return Math.hypot(sx - cx, sy - cy) < 60;
          });
          if (!nearDoor) valid = true;
        }
      }

      if (valid) {
        this.scrap.push({
          x: sx,
          y: sy,
          found: false,
          name: lootTemplate.name,
          value: lootTemplate.baseValue,
          size: lootTemplate.size,
          rarity: lootTemplate.rarity,
          roomType: room.type
        });
      }
    }
  }

  toggleDoor(door, playerX, playerY) {
    if (!door.open) {
      const cx = (door.p1 && door.p2) ? (door.p1.x + door.p2.x) / 2 : (door.x + door.w / 2);
      const cy = (door.p1 && door.p2) ? (door.p1.y + door.p2.y) / 2 : (door.y + door.h / 2);
      if (door.axis === 'h') {
        door.openDir = (playerY < cy) ? 1 : -1;
      } else {
        door.openDir = (playerX < cx) ? 1 : -1;
      }
      door.open = true;
      return { open: true, dir: door.openDir };
    } else {
      door.open = false;
      return { open: false, dir: 0 };
    }
  }

  blocked(x, y, padding = 10) {
    // 1. World outer boundary limit
    if (x < padding || x > Config.WORLD_W - padding || 
        y < padding || y > Config.WORLD_H - padding) {
      return true;
    }

    // 2. Closed doors physically block movement
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      if (!d.open) {
        if (d.p1 && d.p2) {
          if (distToSegment(x, y, d.p1.x, d.p1.y, d.p2.x, d.p2.y) < padding + 8) {
            return true;
          }
        } else if (d.x !== undefined) {
          if (x > d.x - padding && x < d.x + d.w + padding && 
              y > d.y - padding && y < d.y + d.h + padding) {
            return true;
          }
        }
      }
    }

    // 3. Walls (line segments and AABB obstacles)
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
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

    // Walls
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
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
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
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
    let isSegmentHit = false;

    // Walls
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      if (w.x1 !== undefined) {
        const d = raySegmentIntersect(originX, originY, directionX, directionY, w.x1, w.y1, w.x2, w.y2);
        if (d < nearestEntry) {
          nearestEntry = d;
          isSegmentHit = true;
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
          isSegmentHit = false;
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
          isSegmentHit = true;
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
          isSegmentHit = false;
        }
      }
    }

    if (nearestEntry >= maxDistance) return maxDistance;
    const reveal = isSegmentHit ? Math.min(wallReveal, 8) : Math.min(wallReveal, 10);
    return Math.min(maxDistance, nearestEntry + reveal);
  }
}
