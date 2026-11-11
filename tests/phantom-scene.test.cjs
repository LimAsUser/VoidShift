const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function canvas() {
  const calls = [], stack = [];
  let points = [];
  const ctx = { globalAlpha: 1, lineWidth: 1,
    save() { stack.push([this.globalAlpha, this.lineWidth, this.fillStyle, this.strokeStyle]); },
    restore() { [this.globalAlpha, this.lineWidth, this.fillStyle, this.strokeStyle] = stack.pop(); },
    beginPath() { points = []; }, moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); },
    createPattern() { return 'deck-pattern'; },
    createRadialGradient() { return { addColorStop() {} }; }
  };
  for (const kind of ['setTransform', 'translate', 'rotate', 'scale', 'clearRect', 'fillRect', 'strokeRect',
    'fill', 'stroke', 'arc', 'clip', 'fillText', 'drawImage', 'setLineDash', 'closePath', 'rect']) {
    ctx[kind] = function (...args) { calls.push({ kind, args, points: points.slice(), alpha: this.globalAlpha,
      width: this.lineWidth, fill: this.fillStyle, stroke: this.strokeStyle }); };
  }
  return { width: 900, height: 602, clientWidth: 900, clientHeight: 602, calls, ctx, getContext: () => ctx };
}

function setup() {
  const buffers = [];
  const sandbox = { window: { matchMedia: () => ({ matches: false }) },
    Image: class { constructor() { this.complete = true; this.naturalWidth = this.naturalHeight = 512; } },
    document: { createElement() { const surface = canvas(); buffers.push(surface); return surface; } } };
  for (const file of ['config', 'renderer']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8'), sandbox);
  const Renderer = vm.runInNewContext('Renderer', sandbox), world = canvas();
  const renderer = new Renderer({ canvas: world, ctx: world.ctx });
  const room = { x: 0, y: 0, w: 480, h: 320, vertices: [{ x: 0, y: 0 }, { x: 480, y: 0 }, { x: 480, y: 320 }, { x: 0, y: 320 }], lights: [] };
  const map = { worldRooms: [room], walls: [{ x1: 0, y1: 0, x2: 160, y2: 0 }, { x1: 320, y1: 0, x2: 480, y2: 0 }],
    doors: [{ p1: { x: 160, y: 0 }, p2: { x: 320, y: 0 }, open: true, animationProgress: 1 }],
    terminals: [], containers: [], windows: [], scrap: [], getRoomAt: () => room, rayWallDistance: (_x, _y, _dx, _dy, distance) => distance };
  const player = { x: 240, y: 160, angle: 0, flashlight: false, armory: { equippedPassive: null } };
  const state = { elapsed: 0, cameraZoom: 1, powerLossStartedAt: null, bulletTraces: [], impactParticles: [] };
  const draw = () => renderer.draw(player, null, map, state, []);
  return { renderer, room, map, world, buffers, state, draw };
}

function crossesGap(call) {
  const p = call.points;
  return call.kind === 'stroke' && p.some((point, index) => {
    const next = p[index + 1] || p[0];
    return point[1] === 0 && next[1] === 0 && Math.min(point[0], next[0]) < 240 && Math.max(point[0], next[0]) > 240;
  });
}

test('normal-quality floors compose broad quiet panels once and retain the cached surface through door animation', () => {
  const f = setup(); f.draw();
  const surface = f.renderer.roomCache(f.room).floor;
  const panels = surface.calls.filter(call => call.kind === 'fillRect' && call.args[2] >= 160 && call.args[2] <= 200 &&
    call.args[3] >= 120 && call.args[3] <= 170 && call.alpha > 0 && call.alpha <= .06);
  assert.ok(panels.length >= 4, 'broad low-contrast panels are baked into the static floor');
  const allocated = f.buffers.length, composed = surface.calls.length;
  for (const progress of [0, .5, 1]) { f.map.doors[0].animationProgress = progress; f.draw(); }
  assert.equal(f.renderer.roomCache(f.room).floor, surface);
  assert.equal(f.buffers.length, allocated);
  assert.equal(surface.calls.length, composed, 'normal frames and door progress never recompose the floor');
});

test('floor cache does not paint a structural rim across a real door opening', () => {
  const f = setup(); f.draw();
  assert.ok(!f.renderer.roomCache(f.room).floor.calls.some(crossesGap), 'the room polygon is a floor clip, never a wall perimeter');
});

test('raised bulkheads have a short offset shadow but retain the real wall endpoints around an opening', () => {
  const f = setup(); f.draw();
  const strokes = f.world.calls.filter(call => call.kind === 'stroke' && call.points.length === 2 &&
    call.points.every(([x, y]) => x >= 0 && x <= 480 && Math.abs(y) <= 12));
  assert.ok(strokes.some(call => call.alpha < 1 && call.points.every(([, y]) => y > 0)), 'the bulkhead casts a short cosmetic shadow');
  assert.ok(strokes.some(call => call.points.every(([, y]) => y < 0)), 'the upper edge is raised slightly from the floor');
  assert.ok(strokes.every(call => Math.max(...call.points.map(([x]) => x)) <= 160 || Math.min(...call.points.map(([x]) => x)) >= 320),
    'all wall facets stop at their original segment endpoints');
  assert.deepEqual(f.map.walls, [{ x1: 0, y1: 0, x2: 160, y2: 0 }, { x1: 320, y1: 0, x2: 480, y2: 0 }]);
});

test('low quality keeps the simple floor and original wall strokes without allocating scene surfaces', () => {
  const f = setup(); f.state.textureQuality = 'low'; f.draw();
  assert.equal(f.buffers.length, 0);
  assert.ok(f.world.calls.some(call => call.kind === 'fill' && call.fill === '#1c2b35'));
  const walls = f.world.calls.filter(call => call.kind === 'stroke' && call.points.length === 2 && call.points.every(([, y]) => y === 0));
  assert.equal(walls.length, 6);
});

test('floor raster readiness requires positive image dimensions and refreshes only when usable', () => {
  const f = setup(), deck = f.renderer.sprite('starship/floor-deck');
  deck.naturalHeight = 0;
  f.renderer.roomBuffer(f.room, 'floor');
  let surface = f.renderer.roomCache(f.room).floor;
  assert.ok(!surface.calls.some(call => call.kind === 'drawImage'), 'zero-height raster is not sent to Canvas');
  const first = surface;
  deck.naturalHeight = 512;
  f.renderer.roomBuffer(f.room, 'floor');
  surface = f.renderer.roomCache(f.room).floor;
  assert.notEqual(surface, first);
  assert.ok(surface.calls.some(call => call.kind === 'drawImage' && call.args[0] === deck));
  f.renderer.roomBuffer(f.room, 'floor');
  assert.equal(f.renderer.roomCache(f.room).floor, surface);
});

test('zero-size viewport exits before drawing or allocating scene caches', () => {
  const f = setup(); f.world.clientWidth = 0; f.draw();
  assert.equal(f.world.calls.length, 0);
  assert.equal(f.buffers.length, 0);
  f.world.clientWidth = 900; f.world.clientHeight = 0; f.draw();
  assert.equal(f.world.calls.length, 0);
  assert.equal(f.buffers.length, 0);
});
