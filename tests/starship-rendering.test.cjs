const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function canvas() {
  const calls = [], stack = [];
  let points = [];
  const ctx = { globalAlpha: 1, globalCompositeOperation: 'source-over',
    save() { stack.push([this.globalAlpha, this.globalCompositeOperation]); },
    restore() { [this.globalAlpha, this.globalCompositeOperation] = stack.pop(); },
    beginPath() { points = []; }, moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); },
    createPattern() { return 'raster-pattern'; },
    createRadialGradient(...args) { return gradient('radial', args); },
    createConicGradient(...args) { return gradient('conic', args); }
  };
  function gradient(kind, args) {
    const result = { kind, args, stops: [], addColorStop(...stop) { this.stops.push(stop); } };
    calls.push({ kind: 'gradient', gradient: result });
    return result;
  }
  for (const kind of ['setTransform', 'translate', 'rotate', 'scale', 'clearRect', 'fillRect', 'strokeRect',
    'fill', 'stroke', 'arc', 'clip', 'fillText', 'drawImage', 'setLineDash', 'closePath', 'rect']) {
    ctx[kind] = function (...args) { calls.push({ kind, args, points: points.slice(), alpha: this.globalAlpha,
      composite: this.globalCompositeOperation, fill: this.fillStyle, stroke: this.strokeStyle }); };
  }
  return { width: 800, height: 600, clientWidth: 800, clientHeight: 600, style: {}, calls, ctx, getContext: () => ctx };
}

function setup() {
  const buffers = [];
  const sandbox = {
    Image: class { constructor() { this.complete = true; this.naturalWidth = 512; this.naturalHeight = 512; } },
    window: { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) },
    document: { createElement() { const buffer = canvas(); buffers.push(buffer); return buffer; } }
  };
  for (const [file, symbol] of [['config', 'Config'], ['map', 'MapManager'], ['renderer', 'Renderer']]) {
    vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8')}\nglobalThis.${symbol} = ${symbol};`, sandbox);
  }
  const world = canvas(), vision = canvas(), full = canvas();
  const renderer = new sandbox.Renderer({ canvas: world, ctx: world.ctx, visionCanvas: vision, visionCtx: vision.ctx,
    fullMapCanvas: full, fullMapCtx: full.ctx, updateFullMapStats() {} });
  const room = { kind: 'room', type: 'bridge', discovered: true, label: 'BRIDGE', title: 'BRIDGE',
    x: 0, y: 0, w: 400, h: 300, center: { x: 200, y: 150 },
    vertices: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }],
    lights: [{ x1: 20, y1: 20, x2: 380, y2: 20, range: 500 }] };
  const map = Object.assign(Object.create(sandbox.MapManager.prototype), {
    worldW: 4000, worldH: 2000, worldRooms: [room], functionalRooms: [room], walls: [], doors: [], terminals: [], scrap: [], windows: []
  });
  const player = { x: 100, y: 100, angle: 0, flashlight: false, armory: { equippedPassive: null } };
  const state = { elapsed: 0, cameraZoom: 1, cameraLookX: 0, cameraLookY: 0, powerLossStartedAt: null, bulletTraces: [], impactParticles: [] };
  const monster = { x: 180, y: 150, angle: 0, active: false };
  renderer.prepareCamera(player, state);
  return { renderer, map, player, state, room, world, vision, full, buffers, monster, Config: sandbox.Config };
}

test('all lamps flicker four times then go dark, while reduced motion fades without strobing', () => {
  const { renderer } = setup();
  assert.equal(renderer.roomLightLevel({ elapsed: 5, powerLossStartedAt: null }), 1);
  const levels = [0, .15, .5, .65, 1, 1.15, 1.5, 1.65, 2, 5].map(elapsed => renderer.roomLightLevel({ elapsed, powerLossStartedAt: 0 }));
  assert.deepEqual(levels, [1, .08, 1, .08, 1, .08, 1, .08, 0, 0]);
  renderer.motionQuery.matches = true;
  assert.deepEqual([0, .5, 1, 1.5, 2].map(elapsed => renderer.roomLightLevel({ elapsed, powerLossStartedAt: 0 })), [1, .75, .5, .25, 0]);
});

test('ambient lights reuse room buffers, stay forward and stop at closed doors independently of F', () => {
  const { renderer, map, player, state, vision, buffers } = setup();
  map.doors = [{ p1: { x: 120, y: 0 }, p2: { x: 120, y: 300 }, open: false }];
  renderer.drawCenteredVision(player, map, state);
  const ambient = vision.calls.find(call => call.kind === 'drawImage' && call.args.length === 5);
  assert.ok(ambient, 'room light must reveal the lit floor even with the torch off');
  const clip = vision.calls.find(call => call.kind === 'clip');
  assert.ok(clip.points.every(([x]) => x >= player.x && x <= 120.001), 'closed doors and the forward angle constrain ambient visibility');
  const allocated = buffers.length;
  vision.calls.length = 0;
  renderer.drawCenteredVision(player, map, state);
  assert.equal(buffers.length, allocated, 'per-room illumination stays cached');
  map.doors[0].open = true;
  vision.calls.length = 0;
  renderer.drawCenteredVision(player, map, state);
  const openClip = vision.calls.find(call => call.kind === 'clip');
  assert.ok(Math.max(...openClip.points.map(([x]) => x)) > 400, 'an open door permits the existing forward view into lit space');
  const illumination = renderer.roomLightField(map.worldRooms[0], state);
  assert.ok(buffers.includes(illumination.canvas), 'strip light uses its cached room field');
  assert.ok(illumination.values[2 * illumination.width + 25] > illumination.values[30 * illumination.width + 25],
    'near-strip light remains brighter than the far side of the room');
  assert.equal(renderer.roomLightField(map.worldRooms[0], state), illumination);
  state.powerLossStartedAt = 0; state.elapsed = 3;
  vision.calls.length = 0;
  renderer.drawCenteredVision(player, map, state);
  assert.equal(vision.calls.filter(call => call.kind === 'drawImage' && call.args.length === 5).length, 0);
  assert.equal(vision.calls.find(call => call.kind === 'drawImage').alpha, .5, 'darkness preserves the half-strength short perception cone');
});

test('raster room surfaces are cached and offscreen compartments do not allocate surfaces', () => {
  const { renderer, map, player, state, room, world, buffers, monster } = setup();
  map.worldRooms.push({ ...room, x: 3000, center: { x: 3200, y: 150 }, vertices: room.vertices.map(p => ({ x: p.x + 3000, y: p.y })) });
  renderer.draw(player, monster, map, state, []);
  assert.ok(buffers.some(buffer => buffer.calls.some(call => call.kind === 'drawImage' && call.args[0].src?.endsWith('starship/floor-deck.png'))));
  assert.equal(world.calls.filter(call => call.kind === 'drawImage' && call.args[0].getContext).length, 1);
  const allocated = buffers.length;
  renderer.draw(player, monster, map, state, []);
  assert.equal(buffers.length, allocated);
});

test('powered vision retains the original world range regardless of display zoom', () => {
  const { renderer, map, player, state, Config } = setup();
  const ranges = [], original = renderer.forwardVisibilityPolygon;
  renderer.forwardVisibilityPolygon = function (...args) {
    ranges.push(args[2]);
    return original.apply(this, args);
  };
  for (const zoom of [1.25, 1.375, 1.56]) {
    Config.camera.baseZoom = zoom;
    state.cameraZoom = zoom;
    renderer.drawCenteredVision(player, map, state);
  }
  assert.equal(ranges.length, 3);
  for (const range of ranges) assert.ok(Math.abs(range - Math.hypot(900, 602) / 1.56) < 1e-10);
});

test('discovered terminal roomIndex reveals a cyan screen-sized pulse and solved terminals stop pulsing', () => {
  const { renderer, map, player, state, full, room } = setup();
  map.terminals = [{ x: 200, y: 150, roomIndex: 0, solved: false }];
  renderer.drawFullMap(player, map, state);
  assert.ok(full.calls.some(call => call.kind === 'stroke' && call.stroke === '#65ddeb'));
  assert.ok(full.calls.some(call => call.kind === 'fillText' && String(call.args[0]).includes('T-1')));
  full.calls.length = 0; map.terminals[0].solved = true;
  renderer.drawFullMap(player, map, state);
  assert.equal(full.calls.filter(call => call.kind === 'stroke' && call.stroke === '#65ddeb').length, 1, 'only the room outline remains cyan');
  full.calls.length = 0; room.discovered = false;
  renderer.drawFullMap(player, map, state);
  assert.ok(!full.calls.some(call => call.kind === 'fillText' && String(call.args[0]).includes('T-1')));
});

test('life scan reveals living and recovering contacts without revealing terrain or corpses', () => {
  const { renderer, map, player, state, full, room } = setup();
  room.discovered = false;
  state.mapEnemies = [{ x: 300, y: 200, active: true }, { x: 310, y: 210, active: true, recoverTimer: 9 },
    { x: 320, y: 220, active: false, dead: true, corpseTime: 2 }, { x: 330, y: 230, active: false }];
  renderer.drawFullMap(player, map, state);
  assert.equal(full.calls.filter(call => call.kind === 'fill' && call.fill === '#ff615f').length, 0);
  player.armory.equippedPassive = 'life-scan'; full.calls.length = 0;
  renderer.drawFullMap(player, map, state);
  assert.equal(full.calls.filter(call => call.kind === 'fill' && call.fill === '#ff615f').length, 2);
  assert.equal(room.discovered, false);
  assert.ok(!full.calls.some(call => call.kind === 'fillText' && call.args[0] === 'BRIDGE'));
});

test('grenades use their own sprite and orange blast with the same physical blast radius', () => {
  const { renderer, map, player, state, world, monster } = setup();
  state.flashbangs = [{ x: 200, y: 150, skillId: 'grenade', landed: true, fuse: 1 }];
  state.flashBursts = [{ x: 200, y: 150, skillId: 'grenade', lifetime: .2 }];
  renderer.draw(player, monster, map, state, []);
  assert.ok(world.calls.some(call => call.kind === 'drawImage' && call.args[0].src?.endsWith('equipment-v17/grenade.png')));
  assert.ok(world.calls.some(call => call.kind === 'fill' && String(call.fill).startsWith('rgba(255,112,40,')));
  assert.ok(!world.calls.some(call => call.kind === 'fill' && String(call.fill).startsWith('rgba(255,247,211,')));
  const blast = world.calls.find(call => call.kind === 'fill' && String(call.fill).startsWith('rgba(255,112,40,'));
  assert.equal(Math.max(...blast.points.map(([x]) => x)), 320, 'the warning and explosion must match the existing 120-unit damage radius');
});

test('terminal pulses remain the same screen size through zoom and reduced motion holds the rings still', () => {
  const { renderer, full } = setup();
  const terminal = { x: 50, y: 70, solved: false };
  renderer.drawTerminalBeacon(full.ctx, terminal, 0, { elapsed: 0 }, .5);
  const first = full.calls.filter(call => call.kind === 'arc').map(call => call.args[2]);
  assert.deepEqual(full.calls.find(call => call.kind === 'scale').args, [2, 2]);
  full.calls.length = 0;
  renderer.drawTerminalBeacon(full.ctx, terminal, 0, { elapsed: .6 }, 2);
  assert.deepEqual(full.calls.find(call => call.kind === 'scale').args, [.5, .5]);
  assert.notDeepEqual(full.calls.filter(call => call.kind === 'arc').map(call => call.args[2]), first);
  renderer.motionQuery.matches = true;
  full.calls.length = 0;
  renderer.drawTerminalBeacon(full.ctx, terminal, 0, { elapsed: 9.5 }, 1);
  assert.deepEqual(full.calls.filter(call => call.kind === 'arc').map(call => call.args[2]), first);
});
